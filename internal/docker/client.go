package docker

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

const labelPrefix = "openlegion.sandbox.id"

type Client struct {
	Runtime string
}

func NewClient() *Client {
	runtime := strings.TrimSpace(os.Getenv("OPENLEGION_DOCKER_RUNTIME"))
	if runtime == "" {
		runtime = "docker"
	}
	return &Client{Runtime: runtime}
}

func (c *Client) Available(ctx context.Context) error {
	_, err := c.run(ctx, "info")
	return err
}

func (c *Client) CreateNetwork(ctx context.Context, name string) error {
	_, err := c.run(ctx, "network", "create", name)
	return err
}

func (c *Client) RemoveNetwork(ctx context.Context, name string) error {
	_, err := c.run(ctx, "network", "rm", name)
	return err
}

func (c *Client) CreateContainer(ctx context.Context, args []string) (string, error) {
	out, err := c.run(ctx, append([]string{"container", "create"}, args...)...)
	if err != nil {
		return "", err
	}
	id := strings.Fields(strings.TrimSpace(out))[0]
	if id == "" {
		return "", fmt.Errorf("docker returned an empty container id")
	}
	return id, nil
}

func (c *Client) ListSandboxContainers(ctx context.Context) ([]ContainerRecord, error) {
	out, err := c.run(ctx, "ps", "-a", "--filter", "label="+labelPrefix, "--format", "{{json .}}")
	if err != nil {
		return nil, err
	}

	records := make([]ContainerRecord, 0)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		record, err := parseContainerRecord(line)
		if err != nil {
			continue
		}
		records = append(records, record)
	}
	return records, nil
}

func SandboxLabel(sandboxID string) string {
	return labelPrefix + "=" + sandboxID
}

func (c *Client) run(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, c.Runtime, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	out, err := cmd.Output()
	if err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("%s %s: %s", c.Runtime, strings.Join(args, " "), message)
	}
	return string(out), nil
}

type ContainerRecord struct {
	ID        string
	Image     string
	Name      string
	SandboxID string
}

func parseContainerRecord(line string) (ContainerRecord, error) {
	type payload struct {
		ID     string `json:"ID"`
		Image  string `json:"Image"`
		Names  string `json:"Names"`
		Labels string `json:"Labels"`
	}
	var data payload
	if err := jsonUnmarshal(line, &data); err != nil {
		return ContainerRecord{}, err
	}

	return ContainerRecord{
		ID:        data.ID,
		Image:     data.Image,
		Name:      strings.TrimPrefix(strings.TrimSpace(data.Names), "/"),
		SandboxID: parseSandboxLabel(data.Labels),
	}, nil
}

func parseSandboxLabel(raw string) string {
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, labelPrefix+"=") {
			return strings.TrimPrefix(part, labelPrefix+"=")
		}
	}
	return ""
}
