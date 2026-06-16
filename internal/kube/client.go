// Package kube wraps the `kind` and `kubectl` CLIs to run sandbox workloads on a
// single OpenLegion-managed local Kubernetes cluster. It mirrors the shell-out
// style of internal/docker. Each sandbox is a namespace containing one
// Deployment ("workload"); the namespace is the isolation/teardown boundary.
package kube

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

const (
	// ClusterName is the single shared kind cluster all k8s sandboxes live in.
	ClusterName = "openlegion"
	contextName = "kind-" + ClusterName

	labelKey      = "openlegion.sandbox.id"
	imageAnnoKey  = "openlegion.sandbox.image"
	nameAnnoKey   = "openlegion.sandbox.name"
	workloadName  = "workload"
	workloadLabel = "openlegion-workload"
)

type Client struct {
	kind    string
	kubectl string
}

func NewClient() *Client {
	return &Client{
		kind:    envOr("OPENLEGION_KIND_BIN", "kind"),
		kubectl: envOr("OPENLEGION_KUBECTL_BIN", "kubectl"),
	}
}

// Available reports whether the toolchain is installed. It does NOT require the
// cluster to exist — the cluster is provisioned lazily on first Create.
func (c *Client) Available(ctx context.Context) error {
	if _, err := exec.LookPath(c.kind); err != nil {
		return fmt.Errorf("kind is not installed (e.g. `brew install kind`)")
	}
	if _, err := exec.LookPath(c.kubectl); err != nil {
		return fmt.Errorf("kubectl is not installed")
	}
	return nil
}

// --- cluster lifecycle -----------------------------------------------------

func (c *Client) ClusterExists(ctx context.Context) (bool, error) {
	out, err := c.runKind(ctx, "get", "clusters")
	if err != nil {
		return false, err
	}
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == ClusterName {
			return true, nil
		}
	}
	return false, nil
}

// EnsureCluster creates the shared kind cluster if it doesn't exist. This is the
// heavyweight step (pulls a node image, ~30-60s on first run).
func (c *Client) EnsureCluster(ctx context.Context) error {
	exists, err := c.ClusterExists(ctx)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	_, err = c.runKind(ctx, "create", "cluster", "--name", ClusterName, "--wait", "90s")
	return err
}

func (c *Client) DeleteCluster(ctx context.Context) error {
	_, err := c.runKind(ctx, "delete", "cluster", "--name", ClusterName)
	return err
}

// --- sandbox (namespace + deployment) --------------------------------------

type WorkloadSpec struct {
	Image   string
	Name    string
	Command []string
	Env     map[string]string
}

// CreateSandbox creates the namespace and the workload Deployment for a sandbox.
func (c *Client) CreateSandbox(ctx context.Context, namespace, sandboxID string, spec WorkloadSpec) error {
	manifest, err := renderManifest(namespace, sandboxID, spec)
	if err != nil {
		return err
	}
	_, err = c.runKubectlStdin(ctx, manifest, "apply", "-f", "-")
	return err
}

// DeleteSandbox removes the namespace, cascading the deployment/pods.
func (c *Client) DeleteSandbox(ctx context.Context, namespace string) error {
	_, err := c.runKubectl(ctx, "delete", "namespace", namespace, "--ignore-not-found", "--wait=false")
	return err
}

// Scale starts (replicas=1) or stops (replicas=0) the workload.
func (c *Client) Scale(ctx context.Context, namespace string, replicas int) error {
	_, err := c.runKubectl(ctx, "scale", "deployment", workloadName, "-n", namespace, fmt.Sprintf("--replicas=%d", replicas))
	return err
}

func (c *Client) Logs(ctx context.Context, namespace string, tail int) (string, error) {
	args := []string{"logs", "-n", namespace, "deployment/" + workloadName}
	if tail > 0 {
		args = append(args, "--tail", fmt.Sprintf("%d", tail))
	}
	return c.runKubectl(ctx, args...)
}

// ExecShellCommand returns a shell command that opens a session in the workload.
func (c *Client) ExecShellCommand(namespace string) string {
	return fmt.Sprintf("%s --context %s exec -it -n %s deployment/%s -- sh", c.kubectl, contextName, namespace, workloadName)
}

type SandboxRecord struct {
	ID        string
	Namespace string
	Image     string
	Name      string
	Running   bool
}

// ListSandboxes enumerates the labeled namespaces and reports per-workload status.
func (c *Client) ListSandboxes(ctx context.Context) ([]SandboxRecord, error) {
	out, err := c.runKubectl(ctx, "get", "namespaces", "-l", labelKey, "-o", "json")
	if err != nil {
		return nil, err
	}
	var list struct {
		Items []struct {
			Metadata struct {
				Name        string            `json:"name"`
				Labels      map[string]string `json:"labels"`
				Annotations map[string]string `json:"annotations"`
			} `json:"metadata"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(out), &list); err != nil {
		return nil, err
	}

	records := make([]SandboxRecord, 0, len(list.Items))
	for _, item := range list.Items {
		records = append(records, SandboxRecord{
			ID:        item.Metadata.Labels[labelKey],
			Namespace: item.Metadata.Name,
			Image:     item.Metadata.Annotations[imageAnnoKey],
			Name:      item.Metadata.Annotations[nameAnnoKey],
			Running:   c.workloadRunning(ctx, item.Metadata.Name),
		})
	}
	return records, nil
}

func (c *Client) workloadRunning(ctx context.Context, namespace string) bool {
	out, err := c.runKubectl(ctx, "get", "deployment", workloadName, "-n", namespace,
		"-o", "jsonpath={.status.readyReplicas}")
	if err != nil {
		return false
	}
	return strings.TrimSpace(out) != "" && strings.TrimSpace(out) != "0"
}

// --- manifest --------------------------------------------------------------

func renderManifest(namespace, sandboxID string, spec WorkloadSpec) (string, error) {
	command := spec.Command
	if len(command) == 0 {
		// Keep the pod alive so it can be exec'd into, like a sandbox shell.
		command = []string{"sleep", "infinity"}
	}

	container := map[string]any{
		"name":    workloadName,
		"image":   spec.Image,
		"command": command,
	}
	if len(spec.Env) > 0 {
		env := make([]map[string]any, 0, len(spec.Env))
		for k, v := range spec.Env {
			env = append(env, map[string]any{"name": k, "value": v})
		}
		container["env"] = env
	}

	ns := map[string]any{
		"apiVersion": "v1",
		"kind":       "Namespace",
		"metadata": map[string]any{
			"name":   namespace,
			"labels": map[string]any{labelKey: sandboxID},
			"annotations": map[string]any{
				imageAnnoKey: spec.Image,
				nameAnnoKey:  spec.Name,
			},
		},
	}
	deploy := map[string]any{
		"apiVersion": "apps/v1",
		"kind":       "Deployment",
		"metadata": map[string]any{
			"name":      workloadName,
			"namespace": namespace,
			"labels":    map[string]any{labelKey: sandboxID},
		},
		"spec": map[string]any{
			"replicas": 1,
			"selector": map[string]any{"matchLabels": map[string]any{"app": workloadLabel}},
			"template": map[string]any{
				"metadata": map[string]any{"labels": map[string]any{"app": workloadLabel, labelKey: sandboxID}},
				"spec":     map[string]any{"containers": []any{container}},
			},
		},
	}

	list := map[string]any{
		"apiVersion": "v1",
		"kind":       "List",
		"items":      []any{ns, deploy},
	}
	data, err := json.Marshal(list)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// --- exec helpers ----------------------------------------------------------

func (c *Client) runKind(ctx context.Context, args ...string) (string, error) {
	return run(ctx, c.kind, args, nil)
}

func (c *Client) runKubectl(ctx context.Context, args ...string) (string, error) {
	return run(ctx, c.kubectl, append([]string{"--context", contextName}, args...), nil)
}

func (c *Client) runKubectlStdin(ctx context.Context, stdin string, args ...string) (string, error) {
	return run(ctx, c.kubectl, append([]string{"--context", contextName}, args...), strings.NewReader(stdin))
}

func run(ctx context.Context, bin string, args []string, stdin *strings.Reader) (string, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	if stdin != nil {
		cmd.Stdin = stdin
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("%s %s: %s", bin, strings.Join(args, " "), message)
	}
	return string(out), nil
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
