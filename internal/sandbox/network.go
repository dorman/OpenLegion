package sandbox

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/dorman/openlegion/internal/docker"
)

// Envelope is the per-container sandbox boundary. Today this is an isolated
// Docker network plus metadata directory with optional hardening flags
// (see HardeningArgs). Swap Provider for Lima/Kata/etc. when available.
type Envelope struct {
	ID          string
	NetworkName string
	WorkDir     string
}

type Provider interface {
	Provision(ctx context.Context, docker *docker.Client) (Envelope, error)
	Release(ctx context.Context, docker *docker.Client, envelope Envelope) error
}

type NetworkProvider struct {
	RootDir string
}

func SandboxRootDir() string {
	root := os.Getenv("OPENLEGION_SANDBOX_ROOT")
	if root != "" {
		return root
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return os.TempDir()
	}
	return filepath.Join(home, ".openlegion", "sandboxes")
}

func WorkDirFor(id string) string {
	return filepath.Join(SandboxRootDir(), id)
}

func NewNetworkProvider() *NetworkProvider {
	return &NetworkProvider{RootDir: SandboxRootDir()}
}

func (p *NetworkProvider) Provision(ctx context.Context, client *docker.Client) (Envelope, error) {
	id := newSandboxID()
	networkName := "openlegion-sandbox-" + id
	workDir := filepath.Join(p.RootDir, id)

	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return Envelope{}, fmt.Errorf("create sandbox workdir: %w", err)
	}
	if err := client.CreateNetwork(ctx, networkName); err != nil {
		return Envelope{}, fmt.Errorf("create sandbox network: %w", err)
	}

	return Envelope{
		ID:          id,
		NetworkName: networkName,
		WorkDir:     workDir,
	}, nil
}

func (p *NetworkProvider) WorkDir(id string) string {
	return filepath.Join(p.RootDir, id)
}

func (p *NetworkProvider) Release(ctx context.Context, client *docker.Client, envelope Envelope) error {
	if envelope.NetworkName != "" {
		_ = client.RemoveNetwork(ctx, envelope.NetworkName)
	}
	if envelope.WorkDir != "" {
		_ = os.RemoveAll(envelope.WorkDir)
	}
	return nil
}

func newSandboxID() string {
	return newID("sandbox")
}
