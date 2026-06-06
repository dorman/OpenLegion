package engine

import (
	"context"

	"github.com/dorman/openlegion/internal/microvm/types"
)

type Engine interface {
	Available(ctx context.Context) error
	Create(ctx context.Context, req types.CreateVMRequest) (Result, error)
	List(ctx context.Context) ([]types.VMInfo, error)
}
