package types

type PortMapping struct {
	Host      string `json:"host"`
	Container string `json:"container"`
}

type VolumeMapping struct {
	Host      string `json:"host"`
	Container string `json:"container"`
	ReadOnly  *bool  `json:"readOnly,omitempty"`
}

type CreateVMRequest struct {
	Image   string            `json:"image"`
	Name    string            `json:"name,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	Ports   []PortMapping     `json:"ports,omitempty"`
	Volumes []VolumeMapping   `json:"volumes,omitempty"`
	Command []string          `json:"command,omitempty"`
}

type VMInfo struct {
	ID    string `json:"id"`
	Image string `json:"image"`
	Name  string `json:"name,omitempty"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type HealthResponse struct {
	OK       bool     `json:"ok"`
	Features []string `json:"features,omitempty"`
}

type LogsResponse struct {
	Logs string `json:"logs"`
}

type ShellResponse struct {
	Command string `json:"command"`
	Runtime string `json:"runtime"`
}
