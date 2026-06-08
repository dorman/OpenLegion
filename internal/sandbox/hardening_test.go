package sandbox

import (
	"os"
	"testing"
)

func TestHardeningArgsDefault(t *testing.T) {
	t.Setenv("OPENLEGION_SANDBOX_ISOLATION", "")

	args := HardeningArgs()
	if len(args) == 0 {
		t.Fatal("expected default hardening args")
	}
}

func TestHardeningArgsNetworkOnly(t *testing.T) {
	t.Setenv("OPENLEGION_SANDBOX_ISOLATION", "network-only")

	if got := HardeningArgs(); len(got) != 0 {
		t.Fatalf("HardeningArgs() = %v, want empty", got)
	}
}

func TestHardeningArgsOff(t *testing.T) {
	t.Setenv("OPENLEGION_SANDBOX_ISOLATION", "off")

	if got := HardeningArgs(); len(got) != 0 {
		t.Fatalf("HardeningArgs() = %v, want empty", got)
	}
}

func TestHardeningArgsEnvUnsetUsesDefault(t *testing.T) {
	_ = os.Unsetenv("OPENLEGION_SANDBOX_ISOLATION")

	if got := HardeningArgs(); len(got) == 0 {
		t.Fatal("expected hardened defaults when env is unset")
	}
}
