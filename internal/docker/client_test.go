package docker

import "testing"

func TestParseSandboxLabel(t *testing.T) {
	t.Parallel()

	if got := parseSandboxLabel("com.docker.compose.project=foo,openlegion.sandbox.id=sandbox-abc123"); got != "sandbox-abc123" {
		t.Fatalf("parseSandboxLabel() = %q, want sandbox-abc123", got)
	}

	if got := parseSandboxLabel(""); got != "" {
		t.Fatalf("parseSandboxLabel() = %q, want empty", got)
	}
}

func TestParseContainerRecord(t *testing.T) {
	t.Parallel()

	record, err := parseContainerRecord(`{"ID":"abc","Image":"alpine:latest","Names":"/openlegion-sandbox-1-workload","Labels":"openlegion.sandbox.id=sandbox-1"}`)
	if err != nil {
		t.Fatalf("parseContainerRecord() error = %v", err)
	}

	if record.ID != "abc" {
		t.Fatalf("ID = %q, want abc", record.ID)
	}
	if record.SandboxID != "sandbox-1" {
		t.Fatalf("SandboxID = %q, want sandbox-1", record.SandboxID)
	}
	if record.Name != "openlegion-sandbox-1-workload" {
		t.Fatalf("Name = %q", record.Name)
	}
}
