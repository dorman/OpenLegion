package engine

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/dorman/openlegion/internal/microvm/types"
)

func envOrDefault(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// KataSandbox launches security-research desktops as Kata-isolated micro-VMs
// (own guest kernel + KVM hardware boundary) on a no-egress network. It is the
// daemon-side counterpart of host-agent/launch-session.sh, intended to run on a
// dedicated Linux tower; on hosts without the Kata runtime, Available() fails and
// the engine is simply offline. This is the malware-grade isolation path —
// distinct from the shared-kernel Docker/Kubernetes engines used by developers.
type KataSandbox struct {
	docker      string
	runtime     string
	noEgressNet string
	defaultImg  string
}

const (
	kataLabelID   = "openlegion.kata.id"
	kataLabelName = "openlegion.kata.name"
)

func NewKataSandbox() *KataSandbox {
	return &KataSandbox{
		docker:      envOrDefault("OPENLEGION_DOCKER_RUNTIME", "docker"),
		runtime:     envOrDefault("OPENLEGION_KATA_RUNTIME", "kata"),
		noEgressNet: envOrDefault("OPENLEGION_KATA_NETWORK", "openlegion-noegress"),
		defaultImg:  envOrDefault("OPENLEGION_KATA_IMAGE", "openlegion/ghidra:12.1.2"),
	}
}

func (e *KataSandbox) Kind() string { return "kata" }

// Available requires Docker AND the kata runtime registered with it — the latter
// is what distinguishes a verified research host from a plain Docker box.
func (e *KataSandbox) Available(ctx context.Context) error {
	out, err := e.run(ctx, "info", "--format", "{{json .Runtimes}}")
	if err != nil {
		return err
	}
	if !strings.Contains(out, `"`+e.runtime+`"`) {
		return fmt.Errorf("kata runtime %q not registered with docker (run host-agent/setup-kata.sh)", e.runtime)
	}
	return nil
}

func (e *KataSandbox) Create(ctx context.Context, req types.CreateVMRequest) (Result, error) {
	image := strings.TrimSpace(req.Image)
	if image == "" {
		image = e.defaultImg
	}
	id := newKataID()
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "research"
	}

	memory := "2g"
	if req.MemoryMB > 0 {
		memory = fmt.Sprintf("%dm", req.MemoryMB)
	}
	cpus := "2"
	if req.CpuCores > 0 {
		cpus = strconv.Itoa(req.CpuCores)
	}

	// Hardened, unprivileged session — the mirror of launch-session.sh.
	args := []string{
		"run", "-d",
		"--runtime", e.runtime,
		"--name", id,
		"--network", e.noEgressNet,
		"--cap-drop", "ALL",
		"--security-opt", "no-new-privileges",
		"--pids-limit", "512",
		"--memory", memory,
		"--cpus", cpus,
		"--publish", "127.0.0.1::6080",
		"--label", kataLabelID + "=" + id,
		"--label", kataLabelName + "=" + name,
		image,
	}
	if _, err := e.run(ctx, args...); err != nil {
		return Result{}, err
	}
	return Result{ID: id, SandboxID: id}, nil
}

func (e *KataSandbox) List(ctx context.Context) ([]types.VMInfo, error) {
	records, err := e.list(ctx)
	if err != nil {
		// No research host / no sessions is not an error to the caller.
		return []types.VMInfo{}, nil
	}
	out := make([]types.VMInfo, 0, len(records))
	for _, r := range records {
		status := "stopped"
		if strings.EqualFold(r.State, "running") {
			status = "running"
		}
		out = append(out, types.VMInfo{
			ID:      r.ID,
			Image:   r.Image,
			Name:    r.Name,
			Status:  status,
			Kind:    "kata",
			Display: true,
		})
	}
	return out, nil
}

func (e *KataSandbox) Start(ctx context.Context, id string) error {
	_, err := e.run(ctx, "start", id)
	return err
}

func (e *KataSandbox) Stop(ctx context.Context, id string) error {
	_, err := e.run(ctx, "stop", id)
	return err
}

func (e *KataSandbox) Delete(ctx context.Context, id string) error {
	_, err := e.run(ctx, "rm", "-f", id)
	return err
}

func (e *KataSandbox) Logs(ctx context.Context, id string, tail int) (string, error) {
	args := []string{"logs"}
	if tail > 0 {
		args = append(args, "--tail", strconv.Itoa(tail))
	}
	args = append(args, id)
	return e.run(ctx, args...)
}

func (e *KataSandbox) ShellCommand(ctx context.Context, id string) (string, error) {
	if _, err := e.findRecord(ctx, id); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s exec -it %s sh", e.docker, id), nil
}

// Display returns the published noVNC web endpoint (host:port). The session
// serves its own noVNC client, so this kind is "novnc-web" — the UI opens
// http://host:port/vnc.html directly (LAN-local).
func (e *KataSandbox) Display(ctx context.Context, id string) (DisplayInfo, error) {
	if _, err := e.findRecord(ctx, id); err != nil {
		return DisplayInfo{}, err
	}
	out, err := e.run(ctx, "port", id, "6080/tcp")
	if err != nil {
		return DisplayInfo{}, err
	}
	line := strings.TrimSpace(strings.Split(out, "\n")[0])
	host, port, ok := strings.Cut(line, ":")
	if !ok || port == "" {
		return DisplayInfo{}, fmt.Errorf("noVNC port not published for %q", id)
	}
	if host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return DisplayInfo{TargetHost: host, TargetPort: port, Kind: "novnc-web"}, nil
}

type kataRecord struct {
	ID    string
	Image string
	Name  string
	State string
}

func (e *KataSandbox) findRecord(ctx context.Context, id string) (kataRecord, error) {
	records, err := e.list(ctx)
	if err != nil {
		return kataRecord{}, err
	}
	for _, r := range records {
		if r.ID == id || strings.HasPrefix(r.ID, id) {
			return r, nil
		}
	}
	return kataRecord{}, fmt.Errorf("kata session %q not found", id)
}

func (e *KataSandbox) list(ctx context.Context) ([]kataRecord, error) {
	out, err := e.run(ctx, "ps", "-a", "--filter", "label="+kataLabelID, "--format", "{{json .}}")
	if err != nil {
		return nil, err
	}
	records := make([]kataRecord, 0)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var p struct {
			Image  string `json:"Image"`
			Names  string `json:"Names"`
			State  string `json:"State"`
			Labels string `json:"Labels"`
		}
		if err := json.Unmarshal([]byte(line), &p); err != nil {
			continue
		}
		records = append(records, kataRecord{
			ID:    strings.TrimSpace(p.Names),
			Image: p.Image,
			Name:  labelValue(p.Labels, kataLabelName),
			State: p.State,
		})
	}
	return records, nil
}

func (e *KataSandbox) run(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, e.docker, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("%s %s: %s", e.docker, strings.Join(args, " "), msg)
	}
	return string(out), nil
}

func labelValue(raw, key string) string {
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, key+"=") {
			return strings.TrimPrefix(part, key+"=")
		}
	}
	return ""
}

func newKataID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Sprintf("generate kata id: %v", err))
	}
	return "kata-" + hex.EncodeToString(b[:])
}
