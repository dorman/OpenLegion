package engine

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/dorman/openlegion/internal/docker"
	"github.com/dorman/openlegion/internal/microvm/types"
	"github.com/dorman/openlegion/internal/sandbox"
)

type Result struct {
	ID          string
	ContainerID string
	NetworkName string
	SandboxID   string
}

type DockerSandbox struct {
	docker   *docker.Client
	sandbox  sandbox.Provider
}

func NewDockerSandbox() *DockerSandbox {
	return &DockerSandbox{
		docker:  docker.NewClient(),
		sandbox: sandbox.NewNetworkProvider(),
	}
}

func (e *DockerSandbox) Kind() string {
	return "container"
}

func (e *DockerSandbox) Available(ctx context.Context) error {
	return e.docker.Available(ctx)
}

func (e *DockerSandbox) Create(ctx context.Context, req types.CreateVMRequest) (Result, error) {
	envelope, err := e.sandbox.Provision(ctx, e.docker)
	if err != nil {
		return Result{}, err
	}

	args, err := buildCreateArgs(req, envelope)
	if err != nil {
		_ = e.sandbox.Release(ctx, e.docker, envelope)
		return Result{}, err
	}

	containerID, err := e.docker.CreateContainer(ctx, args)
	if err != nil {
		_ = e.sandbox.Release(ctx, e.docker, envelope)
		return Result{}, err
	}

	if err := e.docker.StartContainer(ctx, containerID); err != nil {
		_ = e.docker.RemoveContainer(ctx, containerID)
		_ = e.sandbox.Release(ctx, e.docker, envelope)
		return Result{}, err
	}

	return Result{
		ID:          envelope.ID,
		ContainerID: containerID,
		NetworkName: envelope.NetworkName,
		SandboxID:   envelope.ID,
	}, nil
}

func (e *DockerSandbox) List(ctx context.Context) ([]types.VMInfo, error) {
	records, err := e.docker.ListSandboxContainers(ctx)
	if err != nil {
		return nil, err
	}

	out := make([]types.VMInfo, 0, len(records))
	for _, record := range records {
		id := record.SandboxID
		if id == "" {
			id = record.ID
		}
		status := "stopped"
		if strings.EqualFold(record.State, "running") {
			status = "running"
		}
		out = append(out, types.VMInfo{
			ID:      id,
			Image:   record.Image,
			Name:    record.Name,
			Status:  status,
			Kind:    "container",
			Display: e.hasDisplay(ctx, record.ID),
		})
	}
	return out, nil
}

func (e *DockerSandbox) Start(ctx context.Context, id string) error {
	record, err := e.findRecord(ctx, id)
	if err != nil {
		return err
	}
	running, err := e.docker.ContainerRunning(ctx, record.ID)
	if err != nil {
		return err
	}
	if running {
		return nil
	}
	return e.docker.StartContainer(ctx, record.ID)
}

func (e *DockerSandbox) Stop(ctx context.Context, id string) error {
	record, err := e.findRecord(ctx, id)
	if err != nil {
		return err
	}
	return e.docker.StopContainer(ctx, record.ID)
}

func (e *DockerSandbox) Logs(ctx context.Context, id string, tail int) (string, error) {
	record, err := e.findRecord(ctx, id)
	if err != nil {
		return "", err
	}
	return e.docker.ContainerLogs(ctx, record.ID, tail)
}

func (e *DockerSandbox) Display(ctx context.Context, id string) (DisplayInfo, error) {
	record, err := e.findRecord(ctx, id)
	if err != nil {
		return DisplayInfo{}, err
	}
	running, err := e.docker.ContainerRunning(ctx, record.ID)
	if err != nil {
		return DisplayInfo{}, err
	}
	if !running {
		return DisplayInfo{}, fmt.Errorf("container is not running")
	}
	host, port, err := e.docker.PublishedPort(ctx, record.ID, "5900/tcp")
	if err != nil {
		return DisplayInfo{}, fmt.Errorf("display is not configured for this workload")
	}
	return DisplayInfo{
		TargetHost: host,
		TargetPort: port,
		Kind:       "vnc-websocket",
	}, nil
}

func (e *DockerSandbox) hasDisplay(ctx context.Context, containerID string) bool {
	_, _, err := e.docker.PublishedPort(ctx, containerID, "5900/tcp")
	return err == nil
}

func (e *DockerSandbox) ShellCommand(ctx context.Context, id string) (string, error) {
	record, err := e.findRecord(ctx, id)
	if err != nil {
		return "", err
	}
	running, err := e.docker.ContainerRunning(ctx, record.ID)
	if err != nil {
		return "", err
	}
	if !running {
		return "", fmt.Errorf("container is not running")
	}
	return e.docker.ExecShellCommand(record.ID), nil
}

func (e *DockerSandbox) Delete(ctx context.Context, id string) error {
	record, err := e.findRecord(ctx, id)
	if err != nil {
		return err
	}

	_ = e.docker.StopContainer(ctx, record.ID)
	if err := e.docker.RemoveContainer(ctx, record.ID); err != nil {
		return err
	}

	sandboxID := record.SandboxID
	if sandboxID == "" {
		sandboxID = id
	}

	return e.sandbox.Release(ctx, e.docker, sandbox.Envelope{
		ID:          sandboxID,
		NetworkName: "openlegion-sandbox-" + sandboxID,
		WorkDir:     sandbox.WorkDirFor(sandboxID),
	})
}

func (e *DockerSandbox) findRecord(ctx context.Context, id string) (docker.ContainerRecord, error) {
	records, err := e.docker.ListSandboxContainers(ctx)
	if err != nil {
		return docker.ContainerRecord{}, err
	}

	for _, record := range records {
		if record.SandboxID == id || record.ID == id || strings.HasPrefix(record.ID, id) {
			return record, nil
		}
	}

	return docker.ContainerRecord{}, fmt.Errorf("vm %q not found", id)
}

func buildCreateArgs(req types.CreateVMRequest, envelope sandbox.Envelope) ([]string, error) {
	args := []string{
		"--label", docker.SandboxLabel(envelope.ID),
		"--network", envelope.NetworkName,
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "workload"
	}
	args = append(args, "--name", sandboxScopedName(envelope.ID, name))

	for key, value := range req.Env {
		args = append(args, "--env", fmt.Sprintf("%s=%s", key, value))
	}
	for _, port := range req.Ports {
		args = append(args, "--publish", fmt.Sprintf("%s:%s", port.Host, port.Container))
	}
	for _, volume := range req.Volumes {
		suffix := ""
		if volume.ReadOnly != nil && *volume.ReadOnly {
			suffix = ":ro"
		}
		args = append(args, "--volume", fmt.Sprintf("%s:%s%s", volume.Host, volume.Container, suffix))
	}
	if req.CpuCores > 0 {
		args = append(args, "--cpus", strconv.Itoa(req.CpuCores))
	}

	args = append(args, sandbox.HardeningArgs()...)

	args = append(args, req.Image)
	args = append(args, req.Command...)
	return args, nil
}

func sandboxScopedName(sandboxID, name string) string {
	name = strings.TrimPrefix(strings.TrimSpace(name), "/")
	return "openlegion-" + sandboxID + "-" + name
}
