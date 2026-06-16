package engine

import (
	"context"

	"github.com/dorman/openlegion/internal/microvm/types"
)

type DisplayInfo struct {
	TargetHost string
	TargetPort string
	Password   string
	// Kind is the wire protocol the client should speak to TargetHost:TargetPort,
	// e.g. "vnc-websocket" (raw RFB tunneled over a WebSocket) or "cdp" (a
	// Chrome DevTools Protocol endpoint streamed via Page.startScreencast).
	// Empty is treated as "vnc-websocket" for backward compatibility.
	Kind string
}

type Engine interface {
	Available(ctx context.Context) error
	Create(ctx context.Context, req types.CreateVMRequest) (Result, error)
	List(ctx context.Context) ([]types.VMInfo, error)
	Start(ctx context.Context, id string) error
	Stop(ctx context.Context, id string) error
	Delete(ctx context.Context, id string) error
	Logs(ctx context.Context, id string, tail int) (string, error)
	ShellCommand(ctx context.Context, id string) (string, error)
	Display(ctx context.Context, id string) (DisplayInfo, error)
	Kind() string
}
