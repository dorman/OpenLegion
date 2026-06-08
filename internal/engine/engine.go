package engine

import (
	"context"

	"github.com/dorman/openlegion/internal/microvm/types"
)

type DisplayInfo struct {
	TargetHost string
	TargetPort string
	Password   string
}

type Engine interface {
	Available(ctx context.Context) error
	Create(ctx context.Context, req types.CreateVMRequest) (Result, error)
	List(ctx context.Context) ([]types.VMInfo, error)
	Stop(ctx context.Context, id string) error
	Delete(ctx context.Context, id string) error
	Logs(ctx context.Context, id string, tail int) (string, error)
	ShellCommand(ctx context.Context, id string) (string, error)
	Display(ctx context.Context, id string) (DisplayInfo, error)
	Kind() string
}
