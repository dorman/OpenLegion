package engine

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/dorman/openlegion/internal/kube"
	"github.com/dorman/openlegion/internal/microvm/types"
)

// KubernetesSandbox runs sandbox workloads as namespaces on a single shared,
// OpenLegion-managed kind cluster. Each sandbox is a namespace with one
// Deployment; the cluster is provisioned lazily on the first Create. Pods share
// the host kernel, so this targets the developer / cloud-native audience — not
// malware isolation, which stays on the QEMU VM path.
type KubernetesSandbox struct {
	kube *kube.Client
}

func NewKubernetesSandbox() *KubernetesSandbox {
	return &KubernetesSandbox{kube: kube.NewClient()}
}

func (e *KubernetesSandbox) Kind() string {
	return "kubernetes"
}

func (e *KubernetesSandbox) Available(ctx context.Context) error {
	return e.kube.Available(ctx)
}

func (e *KubernetesSandbox) Create(ctx context.Context, req types.CreateVMRequest) (Result, error) {
	image := strings.TrimSpace(req.Image)
	if image == "" {
		return Result{}, fmt.Errorf("image is required")
	}
	if err := e.kube.EnsureCluster(ctx); err != nil {
		return Result{}, fmt.Errorf("provision kind cluster: %w", err)
	}

	id := newKubernetesID()
	namespace := id // a "k8s-<hex>" id is a valid DNS-1123 namespace name

	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "workload"
	}

	if err := e.kube.CreateSandbox(ctx, namespace, id, kube.WorkloadSpec{
		Image:   image,
		Name:    name,
		Command: req.Command,
		Env:     req.Env,
	}); err != nil {
		_ = e.kube.DeleteSandbox(ctx, namespace)
		return Result{}, err
	}

	return Result{ID: id, SandboxID: id}, nil
}

func (e *KubernetesSandbox) List(ctx context.Context) ([]types.VMInfo, error) {
	records, err := e.kube.ListSandboxes(ctx)
	if err != nil {
		// A missing cluster is not an error — there are simply no k8s sandboxes.
		return []types.VMInfo{}, nil
	}
	out := make([]types.VMInfo, 0, len(records))
	for _, record := range records {
		status := "stopped"
		if record.Running {
			status = "running"
		}
		out = append(out, types.VMInfo{
			ID:      record.ID,
			Image:   record.Image,
			Name:    record.Name,
			Status:  status,
			Kind:    "kubernetes",
			Display: false,
		})
	}
	return out, nil
}

func (e *KubernetesSandbox) Start(ctx context.Context, id string) error {
	return e.kube.Scale(ctx, e.namespace(id), 1)
}

func (e *KubernetesSandbox) Stop(ctx context.Context, id string) error {
	return e.kube.Scale(ctx, e.namespace(id), 0)
}

func (e *KubernetesSandbox) Delete(ctx context.Context, id string) error {
	return e.kube.DeleteSandbox(ctx, e.namespace(id))
}

func (e *KubernetesSandbox) Logs(ctx context.Context, id string, tail int) (string, error) {
	return e.kube.Logs(ctx, e.namespace(id), tail)
}

func (e *KubernetesSandbox) ShellCommand(ctx context.Context, id string) (string, error) {
	if _, err := e.findRecord(ctx, id); err != nil {
		return "", err
	}
	return e.kube.ExecShellCommand(e.namespace(id)), nil
}

func (e *KubernetesSandbox) Display(ctx context.Context, id string) (DisplayInfo, error) {
	return DisplayInfo{}, fmt.Errorf("kubernetes workloads do not have a display")
}

func (e *KubernetesSandbox) findRecord(ctx context.Context, id string) (kube.SandboxRecord, error) {
	records, err := e.kube.ListSandboxes(ctx)
	if err != nil {
		return kube.SandboxRecord{}, err
	}
	for _, record := range records {
		if record.ID == id || strings.HasPrefix(record.ID, id) {
			return record, nil
		}
	}
	return kube.SandboxRecord{}, fmt.Errorf("kubernetes sandbox %q not found", id)
}

// namespace maps a sandbox id to its namespace name (currently identical).
func (e *KubernetesSandbox) namespace(id string) string {
	return id
}

func newKubernetesID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Sprintf("generate kubernetes id: %v", err))
	}
	return "k8s-" + hex.EncodeToString(b[:])
}
