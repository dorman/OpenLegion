package engine

import (
	"strings"
	"testing"

	"github.com/dorman/openlegion/internal/microvm/types"
	"github.com/dorman/openlegion/internal/sandbox"
)

func TestBuildCreateArgsIncludesIsolation(t *testing.T) {
	t.Setenv("OPENLEGION_SANDBOX_ISOLATION", "")

	args, err := buildCreateArgs(types.CreateVMRequest{
		Image: "alpine:latest",
		Name:  "workload",
		Command: []string{
			"sleep",
			"3600",
		},
	}, sandbox.Envelope{
		ID:          "sandbox-1",
		NetworkName: "openlegion-sandbox-sandbox-1",
	})
	if err != nil {
		t.Fatalf("buildCreateArgs() error = %v", err)
	}

	joined := strings.Join(args, " ")
	for _, want := range []string{
		"--label openlegion.sandbox.id=sandbox-1",
		"--network openlegion-sandbox-sandbox-1",
		"--cap-drop=ALL",
		"--security-opt=no-new-privileges",
		"alpine:latest",
		"sleep",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("buildCreateArgs() = %q, missing %q", joined, want)
		}
	}
}
