package sandbox

import (
	"os"
	"strings"
)

func HardeningArgs() []string {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("OPENLEGION_SANDBOX_ISOLATION")))
	if mode == "none" || mode == "off" || mode == "network-only" {
		return nil
	}

	return []string{
		"--cap-drop=ALL",
		"--security-opt=no-new-privileges",
		"--pids-limit=256",
		"--init",
		"--tmpfs", "/tmp:exec",
	}
}
