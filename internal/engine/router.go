package engine

import (
	"context"
	"fmt"
	"strings"

	"github.com/dorman/openlegion/internal/microvm/types"
)

type Router struct {
	docker *DockerSandbox
	qemu   *QemuSandbox
}

func NewRouter() *Router {
	return &Router{
		docker: NewDockerSandbox(),
		qemu:   NewQemuSandbox(),
	}
}

func (r *Router) Kind() string {
	return "router"
}

func (r *Router) Available(ctx context.Context) error {
	return r.docker.Available(ctx)
}

func (r *Router) Create(ctx context.Context, req types.CreateVMRequest) (Result, error) {
	if isDesktopKind(req.Kind) {
		return r.qemu.Create(ctx, req)
	}
	return r.docker.Create(ctx, req)
}

func (r *Router) List(ctx context.Context) ([]types.VMInfo, error) {
	dockerItems, err := r.docker.List(ctx)
	if err != nil {
		return nil, err
	}
	for index := range dockerItems {
		if dockerItems[index].Kind == "" {
			dockerItems[index].Kind = "container"
		}
	}

	qemuItems, err := r.qemu.List(ctx)
	if err != nil {
		return dockerItems, nil
	}

	return append(dockerItems, qemuItems...), nil
}

func (r *Router) Start(ctx context.Context, id string) error {
	engine, err := r.resolve(id)
	if err != nil {
		return err
	}
	return engine.Start(ctx, id)
}

func (r *Router) Stop(ctx context.Context, id string) error {
	engine, err := r.resolve(id)
	if err != nil {
		return err
	}
	return engine.Stop(ctx, id)
}

func (r *Router) Delete(ctx context.Context, id string) error {
	engine, err := r.resolve(id)
	if err != nil {
		return err
	}
	return engine.Delete(ctx, id)
}

func (r *Router) Logs(ctx context.Context, id string, tail int) (string, error) {
	engine, err := r.resolve(id)
	if err != nil {
		return "", err
	}
	return engine.Logs(ctx, id, tail)
}

func (r *Router) ShellCommand(ctx context.Context, id string) (string, error) {
	engine, err := r.resolve(id)
	if err != nil {
		return "", err
	}
	return engine.ShellCommand(ctx, id)
}

func (r *Router) Display(ctx context.Context, id string) (DisplayInfo, error) {
	engine, err := r.resolve(id)
	if err != nil {
		return DisplayInfo{}, err
	}
	return engine.Display(ctx, id)
}

func (r *Router) resolve(id string) (Engine, error) {
	if strings.HasPrefix(id, "desktop-") {
		return r.qemu, nil
	}
	if _, err := r.qemu.findRecord(id); err == nil {
		return r.qemu, nil
	}
	if _, err := r.docker.findRecord(context.Background(), id); err == nil {
		return r.docker, nil
	}
	return nil, fmt.Errorf("vm %q not found", id)
}

func isDesktopKind(kind string) bool {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "desktop", "qemu", "vm":
		return true
	default:
		return false
	}
}
