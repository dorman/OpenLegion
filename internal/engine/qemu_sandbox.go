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
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/dorman/openlegion/internal/microvm/types"
)

// Pin the guest display to a fixed resolution via the virtio-gpu EDID. Without
// this the guest picks a default mode that can be too short for tall content
// (e.g. an installer's button bar gets clipped). The viewer letterboxes to fit,
// so a generous, tall mode is safe. 1440x900 comfortably exceeds the graphical
// installer minimums while keeping a standard desktop aspect ratio.
const (
	desktopScreenWidth  = 1440
	desktopScreenHeight = 900
	// guestCDPPort is the in-guest port headless Chromium listens on for the
	// Chrome DevTools Protocol; the host reaches it via a QEMU hostfwd.
	guestCDPPort = 9222
)

type qemuRecord struct {
	ID           string `json:"id"`
	Image        string `json:"image"`
	Name         string `json:"name,omitempty"`
	Status       string `json:"status"`
	MemoryMB     int    `json:"memoryMb"`
	VNCPort      int    `json:"vncPort"`
	CDPPort      int    `json:"cdpPort,omitempty"`
	SerialSocket string `json:"serialSocket,omitempty"`
	PID          int    `json:"pid,omitempty"`
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
	_, err := qemuBinary()
	return err
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
	cpuCores := req.CpuCores
	if cpuCores <= 0 {
		cpuCores = defaultQemuCpuCores()
	}
	diskGB := req.DiskGb
	if diskGB <= 0 {
		diskGB = defaultQemuDiskGB()
	}

	image := strings.TrimSpace(req.Image)
	if image == "" {
		image = imagePath("")
	}
	if image == "" {
		return Result{}, fmt.Errorf("desktop image is required")
	}
	if err := validateDesktopImage(image); err != nil {
		return Result{}, err
	}

	vmDir := filepath.Join(e.rootDir, id)
	if err := os.MkdirAll(vmDir, 0o755); err != nil {
		return Result{}, fmt.Errorf("create vm dir: %w", err)
	}

	disk := filepath.Join(vmDir, "disk.qcow2")
	isoPath, err := prepareDesktopDisk(image, disk, diskGB)
	if err != nil {
		_ = os.RemoveAll(vmDir)
		return Result{}, err
	}

	vncPort, err := freeVNCPort()
	if err != nil {
		_ = os.RemoveAll(vmDir)
		return Result{}, err
	}

	cdpPort, err := freeCDPPort()
	if err != nil {
		_ = os.RemoveAll(vmDir)
		return Result{}, err
	}

	serialSocket := serialSocketPath(vmDir)
	pid, err := startQemu(ctx, qemuStartConfig{
		vmDir:        vmDir,
		disk:         disk,
		iso:          isoPath,
		memoryMB:     memoryMB,
		cpuCores:     cpuCores,
		vncPort:      vncPort,
		cdpPort:      cdpPort,
		serialSocket: serialSocket,
		pidFile:      filepath.Join(vmDir, "qemu.pid"),
		logFile:      filepath.Join(vmDir, "qemu.log"),
	})
	if err != nil {
		_ = os.RemoveAll(vmDir)
		return Result{}, err
	}

	record := qemuRecord{
		ID:           id,
		Image:        filepath.Base(image),
		Name:         name,
		Status:       "running",
		MemoryMB:     memoryMB,
		VNCPort:      vncPort,
		CDPPort:      cdpPort,
		SerialSocket: serialSocket,
		PID:          pid,
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

func (e *QemuSandbox) Start(ctx context.Context, id string) error {
	record, err := e.findRecord(id)
	if err != nil {
		return err
	}
	record = refreshQemuStatus(record)
	if record.Status == "running" {
		return nil
	}

	vmDir := filepath.Join(e.rootDir, record.ID)
	disk := filepath.Join(vmDir, "disk.qcow2")
	if _, err := os.Stat(disk); err != nil {
		return fmt.Errorf("desktop disk is missing")
	}

	memoryMB := record.MemoryMB
	if memoryMB <= 0 {
		memoryMB = defaultQemuMemoryMB()
	}

	vncPort := record.VNCPort
	if vncPort <= 0 || !vncPortAvailable(vncPort) {
		vncPort, err = freeVNCPort()
		if err != nil {
			return err
		}
	}

	cdpPort := record.CDPPort
	if cdpPort <= 0 || !vncPortAvailable(cdpPort) {
		cdpPort, err = freeCDPPort()
		if err != nil {
			return err
		}
	}

	serialSocket := serialSocketPath(vmDir)
	pid, err := startQemu(ctx, qemuStartConfig{
		vmDir:        vmDir,
		disk:         disk,
		memoryMB:     memoryMB,
		cpuCores:     defaultQemuCpuCores(),
		vncPort:      vncPort,
		cdpPort:      cdpPort,
		serialSocket: serialSocket,
		pidFile:      filepath.Join(vmDir, "qemu.pid"),
		logFile:      filepath.Join(vmDir, "qemu.log"),
	})
	if err != nil {
		return err
	}

	record.Status = "running"
	record.PID = pid
	record.VNCPort = vncPort
	record.CDPPort = cdpPort
	record.MemoryMB = memoryMB
	record.SerialSocket = serialSocket
	return writeQemuRecord(vmDir, record)
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
	record = refreshQemuStatus(record)
	if record.Status != "running" {
		return "", fmt.Errorf("desktop vm is not running")
	}
	socket := record.SerialSocket
	if socket == "" {
		socket = serialSocketPath(filepath.Join(e.rootDir, record.ID))
	}
	if _, err := os.Stat(socket); err != nil {
		return "", fmt.Errorf("serial console is unavailable — restart this desktop vm to enable shell access")
	}
	return serialConsoleCommand(socket)
}

func (e *QemuSandbox) Display(ctx context.Context, id string) (DisplayInfo, error) {
	record, err := e.findRecord(id)
	if err != nil {
		return DisplayInfo{}, err
	}
	record = refreshQemuStatus(record)
	if record.Status != "running" {
		return DisplayInfo{}, fmt.Errorf("desktop vm is not running")
	}
	// Prefer the CDP browser endpoint (low-latency, agent-drivable). Fall back to
	// the VNC desktop for older VMs created before CDP was provisioned.
	if record.CDPPort > 0 {
		return DisplayInfo{
			TargetHost: "127.0.0.1",
			TargetPort: strconv.Itoa(record.CDPPort),
			Kind:       "cdp",
		}, nil
	}
	if record.VNCPort <= 0 {
		return DisplayInfo{}, fmt.Errorf("desktop vm is not running")
	}
	return DisplayInfo{
		TargetHost: "127.0.0.1",
		TargetPort: strconv.Itoa(record.VNCPort),
		Kind:       "vnc-websocket",
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
	vmDir        string
	disk         string
	iso          string
	memoryMB     int
	cpuCores     int
	vncPort      int
	cdpPort      int
	serialSocket string
	pidFile      string
	logFile      string
}

func startQemu(ctx context.Context, cfg qemuStartConfig) (int, error) {
	binary, err := qemuBinary()
	if err != nil {
		return 0, err
	}

	args := []string{
		"-machine", "virt",
		"-m", strconv.Itoa(cfg.memoryMB),
	}
	if cfg.cpuCores > 0 {
		args = append(args, "-smp", strconv.Itoa(cfg.cpuCores))
	}
	// Forward a host port to the guest's headless-Chromium debug port (9222) so
	// the CDP display can reach it. QEMU user-mode networking otherwise hides the
	// guest behind NAT. VNC stays on its own host-side QEMU socket as the
	// full-desktop fallback; CDP is the fast browser path.
	netdev := "user,id=net0"
	if cfg.cdpPort > 0 {
		netdev += fmt.Sprintf(",hostfwd=tcp:127.0.0.1:%d-:%d", cfg.cdpPort, guestCDPPort)
	}
	args = append(args,
		"-vga", "none",
		"-drive", "if=none,file=" + cfg.disk + ",format=qcow2,id=hd",
		"-device", "virtio-blk-pci,drive=hd",
		"-netdev", netdev,
		"-device", "virtio-net-pci,netdev=net0",
		"-device", fmt.Sprintf("virtio-gpu-pci,edid=on,xres=%d,yres=%d", desktopScreenWidth, desktopScreenHeight),
		"-device", "qemu-xhci,id=xhci",
		"-device", "usb-kbd,bus=xhci.0",
		"-device", "usb-tablet,bus=xhci.0",
	)
	args = appendSerialConsoleArgs(args, cfg.serialSocket)
	args = append(args,
		"-parallel", "null",
		"-monitor", "none",
		"-display", "none",
		"-vnc", fmt.Sprintf("127.0.0.1:%d", cfg.vncPort-5900),
		"-daemonize",
		"-pidfile", cfg.pidFile,
	)
	args = append(qemuFirmwareArgs(cfg.vmDir), args...)
	if cfg.iso != "" {
		args = append(args,
			"-drive", "if=none,file="+cfg.iso+",format=raw,readonly=on,id=cd",
			"-device", "virtio-scsi-pci,id=scsi0",
			"-device", "scsi-cd,bus=scsi0.0,drive=cd",
			"-boot", "order=dc",
		)
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

func qemuFirmwareArgs(vmDir string) []string {
	dirs := []string{"/opt/homebrew/share/qemu", "/usr/local/share/qemu"}
	for _, dir := range dirs {
		code := filepath.Join(dir, "edk2-aarch64-code.fd")
		varsTemplate := filepath.Join(dir, "edk2-arm-vars.fd")
		if _, err := os.Stat(code); err != nil {
			continue
		}
		vars := filepath.Join(vmDir, "uefi-vars.fd")
		if _, err := os.Stat(vars); err != nil {
			if _, err := os.Stat(varsTemplate); err == nil {
				if err := copyFile(varsTemplate, vars); err != nil {
					return nil
				}
			}
		}
		args := []string{
			"-drive", "if=pflash,format=raw,readonly=on,file=" + code,
		}
		if _, err := os.Stat(vars); err == nil {
			args = append(args, "-drive", "if=pflash,format=raw,file="+vars)
		}
		return args
	}
	return nil
}

func copyFile(source, dest string) error {
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

func qemuAccelArgs(binary string) []string {
	if strings.Contains(binary, "aarch64") {
		if _, err := exec.LookPath(binary); err == nil {
			return []string{"-cpu", "host", "-accel", "hvf"}
		}
	}
	return []string{"-cpu", "max"}
}

func qemuBinary() (string, error) {
	return findTool([]string{"qemu-system-aarch64", "qemu-system-x86_64"})
}

func qemuImgBinary() (string, error) {
	return findTool([]string{"qemu-img"})
}

func findTool(names []string) (string, error) {
	dirs := []string{"/opt/homebrew/bin", "/usr/local/bin"}
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, ".nix-profile", "bin"))
	}
	for _, dir := range dirs {
		for _, name := range names {
			full := filepath.Join(dir, name)
			if info, err := os.Stat(full); err == nil && !info.IsDir() {
				return full, nil
			}
		}
	}
	for _, name := range names {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}
	if len(names) == 1 && names[0] == "qemu-img" {
		return "", fmt.Errorf("qemu-img is not installed (install with: brew install qemu)")
	}
	return "", fmt.Errorf("qemu is not installed (install with: brew install qemu)")
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

func defaultQemuCpuCores() int {
	raw := strings.TrimSpace(os.Getenv("OPENLEGION_QEMU_CPU_CORES"))
	if raw == "" {
		return 2
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 2
	}
	return value
}

func defaultQemuDiskGB() int {
	raw := strings.TrimSpace(os.Getenv("OPENLEGION_QEMU_DISK_GB"))
	if raw == "" {
		return 24
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 24
	}
	return value
}

func prepareDesktopDisk(source, dest string, diskGB int) (string, error) {
	if diskGB <= 0 {
		diskGB = defaultQemuDiskGB()
	}
	if _, err := os.Stat(source); err != nil {
		return "", fmt.Errorf("desktop image %q is missing", source)
	}
	if isISOPath(source) {
		if err := createEmptyDisk(dest, diskGB); err != nil {
			return "", err
		}
		return source, nil
	}
	if err := ensureDiskImage(source, dest); err != nil {
		return "", err
	}
	return "", nil
}

func isISOPath(path string) bool {
	return strings.HasSuffix(strings.ToLower(strings.TrimSpace(path)), ".iso")
}

func validateDesktopImage(image string) error {
	binary, err := qemuBinary()
	if err != nil {
		return err
	}
	lower := strings.ToLower(filepath.Base(image))
	onAarch64 := strings.Contains(binary, "aarch64") || strings.Contains(strings.ToLower(runtime.GOARCH), "arm")
	if !onAarch64 {
		return nil
	}
	for _, token := range []string{"amd64", "x86_64", "x64"} {
		if strings.Contains(lower, token) {
			return fmt.Errorf("amd64 ISO cannot boot in an arm64 VM on Apple Silicon; download an arm64 or aarch64 Ubuntu image instead")
		}
	}
	return nil
}

func createEmptyDisk(path string, sizeGB int) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	}
	qemuImg, err := qemuImgBinary()
	if err != nil {
		return err
	}
	cmd := exec.Command(qemuImg, "create", "-f", "qcow2", path, fmt.Sprintf("%dG", sizeGB))
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("create disk image: %s", strings.TrimSpace(string(output)))
	}
	return nil
}

func ensureDiskImage(source, dest string) error {
	if _, err := os.Stat(dest); err == nil {
		return nil
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
		if !vncPortAvailable(port) {
			continue
		}
		return port, nil
	}
	return 0, fmt.Errorf("no free vnc port in range 5900-5999")
}

// freeCDPPort picks a free host port to forward to the guest's Chromium debug
// port. Kept in a distinct range from VNC (5900-5999) to avoid collisions.
func freeCDPPort() (int, error) {
	for port := 9222; port < 9322; port++ {
		if !vncPortAvailable(port) {
			continue
		}
		return port, nil
	}
	return 0, fmt.Errorf("no free cdp port in range 9222-9321")
}

func vncPortAvailable(port int) bool {
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return false
	}
	listener.Close()
	return true
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

func serialSocketPath(vmDir string) string {
	return filepath.Join(vmDir, "serial.sock")
}

func appendSerialConsoleArgs(args []string, socket string) []string {
	_ = os.Remove(socket)
	return append(args,
		"-chardev", "socket,id=serial0,path="+socket+",server=on,wait=off",
		"-serial", "chardev:serial0",
	)
}

func serialConsoleCommand(socket string) (string, error) {
	quoted := strconv.Quote(socket)
	if _, err := exec.LookPath("socat"); err == nil {
		return "socat STDIO,raw,echo=0 UNIX-CONNECT:" + quoted, nil
	}
	if _, err := exec.LookPath("nc"); err == nil {
		return "nc -U " + quoted, nil
	}
	return "", fmt.Errorf("install socat to use the desktop serial console (brew install socat)")
}
