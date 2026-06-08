package engine

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/dorman/openlegion/internal/microvm/types"
)

type qemuRecord struct {
	ID       string `json:"id"`
	Image    string `json:"image"`
	Name     string `json:"name,omitempty"`
	Status   string `json:"status"`
	MemoryMB int    `json:"memoryMb"`
	VNCPort  int    `json:"vncPort"`
	PID      int    `json:"pid,omitempty"`
}

type QemuSandbox struct {
	mu      sync.Mutex
	rootDir string
}

func NewQemuSandbox() *QemuSandbox {
	return &QemuSandbox{rootDir: qemuRootDir()}
}

func (e *QemuSandbox) Kind() string {
	return "desktop"
}

func (e *QemuSandbox) Available(ctx context.Context) error {
	if _, err := qemuBinary(); err != nil {
		return err
	}
	if imagePath("") == "" {
		return fmt.Errorf("qemu desktop image is not configured (set OPENLEGION_QEMU_IMAGE)")
	}
	return nil
}

func (e *QemuSandbox) Create(ctx context.Context, req types.CreateVMRequest) (Result, error) {
	if err := e.Available(ctx); err != nil {
		return Result{}, err
	}

	id := newDesktopID()
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "desktop"
	}
	memoryMB := req.MemoryMB
	if memoryMB <= 0 {
		memoryMB = defaultQemuMemoryMB()
	}

	image := strings.TrimSpace(req.Image)
	if image == "" {
		image = imagePath("")
	}
	if image == "" {
		return Result{}, fmt.Errorf("desktop image is required")
	}

	vmDir := filepath.Join(e.rootDir, id)
	if err := os.MkdirAll(vmDir, 0o755); err != nil {
		return Result{}, fmt.Errorf("create vm dir: %w", err)
	}

	disk := filepath.Join(vmDir, "disk.qcow2")
	if err := ensureDiskImage(image, disk); err != nil {
		_ = os.RemoveAll(vmDir)
		return Result{}, err
	}

	vncPort, err := freeVNCPort()
	if err != nil {
		_ = os.RemoveAll(vmDir)
		return Result{}, err
	}

	pid, err := startQemu(ctx, qemuStartConfig{
		disk:     disk,
		memoryMB: memoryMB,
		vncPort:  vncPort,
		pidFile:  filepath.Join(vmDir, "qemu.pid"),
		logFile:  filepath.Join(vmDir, "qemu.log"),
	})
	if err != nil {
		_ = os.RemoveAll(vmDir)
		return Result{}, err
	}

	record := qemuRecord{
		ID:       id,
		Image:    filepath.Base(image),
		Name:     name,
		Status:   "running",
		MemoryMB: memoryMB,
		VNCPort:  vncPort,
		PID:      pid,
	}
	if err := writeQemuRecord(vmDir, record); err != nil {
		_ = stopPID(pid)
		_ = os.RemoveAll(vmDir)
		return Result{}, err
	}

	return Result{
		ID:        id,
		SandboxID: id,
	}, nil
}

func (e *QemuSandbox) List(ctx context.Context) ([]types.VMInfo, error) {
	entries, err := os.ReadDir(e.rootDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []types.VMInfo{}, nil
		}
		return nil, err
	}

	out := make([]types.VMInfo, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		record, err := readQemuRecord(filepath.Join(e.rootDir, entry.Name()))
		if err != nil {
			continue
		}
		record = refreshQemuStatus(record)
		_ = writeQemuRecord(filepath.Join(e.rootDir, record.ID), record)

		status := "stopped"
		if record.Status == "running" {
			status = "running"
		}
		out = append(out, types.VMInfo{
			ID:      record.ID,
			Image:   record.Image,
			Name:    record.Name,
			Status:  status,
			Kind:    "desktop",
			Display: true,
		})
	}
	return out, nil
}

func (e *QemuSandbox) Stop(ctx context.Context, id string) error {
	record, err := e.findRecord(id)
	if err != nil {
		return err
	}
	if record.PID <= 0 {
		record.Status = "stopped"
		return writeQemuRecord(filepath.Join(e.rootDir, record.ID), record)
	}
	if err := stopPID(record.PID); err != nil {
		return err
	}
	record.Status = "stopped"
	record.PID = 0
	return writeQemuRecord(filepath.Join(e.rootDir, record.ID), record)
}

func (e *QemuSandbox) Delete(ctx context.Context, id string) error {
	record, err := e.findRecord(id)
	if err != nil {
		return err
	}
	if record.PID > 0 {
		_ = stopPID(record.PID)
	}
	return os.RemoveAll(filepath.Join(e.rootDir, record.ID))
}

func (e *QemuSandbox) Logs(ctx context.Context, id string, tail int) (string, error) {
	record, err := e.findRecord(id)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(e.rootDir, record.ID, "qemu.log"))
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	lines := strings.Split(string(data), "\n")
	if tail <= 0 || tail >= len(lines) {
		return string(data), nil
	}
	return strings.Join(lines[len(lines)-tail:], "\n"), nil
}

func (e *QemuSandbox) ShellCommand(ctx context.Context, id string) (string, error) {
	record, err := e.findRecord(id)
	if err != nil {
		return "", err
	}
	if record.Status != "running" {
		return "", fmt.Errorf("desktop vm is not running")
	}
	return "", fmt.Errorf("interactive shell is not available for desktop vms yet")
}

func (e *QemuSandbox) Display(ctx context.Context, id string) (DisplayInfo, error) {
	record, err := e.findRecord(id)
	if err != nil {
		return DisplayInfo{}, err
	}
	record = refreshQemuStatus(record)
	if record.Status != "running" || record.VNCPort <= 0 {
		return DisplayInfo{}, fmt.Errorf("desktop vm is not running")
	}
	return DisplayInfo{
		TargetHost: "127.0.0.1",
		TargetPort: strconv.Itoa(record.VNCPort),
	}, nil
}

func (e *QemuSandbox) findRecord(id string) (qemuRecord, error) {
	entries, err := os.ReadDir(e.rootDir)
	if err != nil {
		return qemuRecord{}, err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		record, err := readQemuRecord(filepath.Join(e.rootDir, entry.Name()))
		if err != nil {
			continue
		}
		if record.ID == id || strings.HasPrefix(record.ID, id) {
			return record, nil
		}
	}
	return qemuRecord{}, fmt.Errorf("vm %q not found", id)
}

type qemuStartConfig struct {
	disk     string
	memoryMB int
	vncPort  int
	pidFile  string
	logFile  string
}

func startQemu(ctx context.Context, cfg qemuStartConfig) (int, error) {
	binary, err := qemuBinary()
	if err != nil {
		return 0, err
	}

	args := []string{
		"-machine", "virt",
		"-m", strconv.Itoa(cfg.memoryMB),
		"-drive", "file=" + cfg.disk + ",if=virtio,format=qcow2",
		"-netdev", "user,id=net0",
		"-device", "virtio-net-pci,netdev=net0",
		"-display", "none",
		"-vnc", fmt.Sprintf("127.0.0.1:%d", cfg.vncPort-5900),
		"-daemonize",
		"-pidfile", cfg.pidFile,
	}

	args = append(qemuAccelArgs(binary), args...)

	logFile, err := os.OpenFile(cfg.logFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return 0, err
	}
	defer logFile.Close()

	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if err := cmd.Run(); err != nil {
		return 0, fmt.Errorf("start qemu: %w", err)
	}

	data, err := os.ReadFile(cfg.pidFile)
	if err != nil {
		return 0, fmt.Errorf("read qemu pidfile: %w", err)
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return 0, fmt.Errorf("parse qemu pid: %w", err)
	}
	return pid, nil
}

func qemuAccelArgs(binary string) []string {
	if strings.Contains(binary, "aarch64") {
		if _, err := exec.LookPath(binary); err == nil {
			return []string{"-cpu", "host", "-accel", "hvf"}
		}
	}
	return []string{"-cpu", "max"}
}

func qemuBinary() (string, error) {
	candidates := []string{
		"qemu-system-aarch64",
		"qemu-system-x86_64",
	}
	for _, name := range candidates {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("qemu-system binary is not available on PATH")
}

func qemuRootDir() string {
	root := strings.TrimSpace(os.Getenv("OPENLEGION_QEMU_ROOT"))
	if root != "" {
		return root
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "openlegion-qemu")
	}
	return filepath.Join(home, ".openlegion", "qemu-vms")
}

func imagePath(fallback string) string {
	if path := strings.TrimSpace(os.Getenv("OPENLEGION_QEMU_IMAGE")); path != "" {
		return path
	}
	return strings.TrimSpace(fallback)
}

func defaultQemuMemoryMB() int {
	raw := strings.TrimSpace(os.Getenv("OPENLEGION_QEMU_MEMORY_MB"))
	if raw == "" {
		return 2048
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 2048
	}
	return value
}

func ensureDiskImage(source, dest string) error {
	if _, err := os.Stat(dest); err == nil {
		return nil
	}
	if _, err := os.Stat(source); err != nil {
		return fmt.Errorf("desktop image %q is missing", source)
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

func freeVNCPort() (int, error) {
	for port := 5900; port < 6000; port++ {
		listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
		if err != nil {
			continue
		}
		listener.Close()
		return port, nil
	}
	return 0, fmt.Errorf("no free vnc port in range 5900-5999")
}

func newDesktopID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(fmt.Sprintf("generate desktop id: %v", err))
	}
	return "desktop-" + hex.EncodeToString(b[:])
}

func readQemuRecord(dir string) (qemuRecord, error) {
	data, err := os.ReadFile(filepath.Join(dir, "vm.json"))
	if err != nil {
		return qemuRecord{}, err
	}
	var record qemuRecord
	if err := json.Unmarshal(data, &record); err != nil {
		return qemuRecord{}, err
	}
	return record, nil
}

func writeQemuRecord(dir string, record qemuRecord) error {
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "vm.json"), data, 0o644)
}

func refreshQemuStatus(record qemuRecord) qemuRecord {
	if record.PID <= 0 {
		record.Status = "stopped"
		return record
	}
	process, err := os.FindProcess(record.PID)
	if err != nil {
		record.Status = "stopped"
		record.PID = 0
		return record
	}
	if err := process.Signal(syscall.Signal(0)); err != nil {
		record.Status = "stopped"
		record.PID = 0
	}
	return record
}

func stopPID(pid int) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	if err := process.Signal(syscall.SIGTERM); err != nil {
		return process.Kill()
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if err := process.Signal(syscall.Signal(0)); err != nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return process.Kill()
}
