package engine

import (
	"context"
	"fmt"
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
		out = append(out, types.VMInfo{
			ID:    id,
			Image: record.Image,
			Name:  record.Name,
		})
	}
	return out, nil
}

func (e *DockerSandbox) Stop(ctx context.Context, id string) error {
	record, err := e.findRecord(ctx, id)
	if err != nil {
		return err
	}
	return e.docker.StopContainer(ctx, record.ID)
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

	args = append(args, req.Image)
	args = append(args, req.Command...)
	return args, nil
}

func sandboxScopedName(sandboxID, name string) string {
	name = strings.TrimPrefix(strings.TrimSpace(name), "/")
	return "openlegion-" + sandboxID + "-" + name
}
