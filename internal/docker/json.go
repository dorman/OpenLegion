package docker

import "encoding/json"

func jsonUnmarshal(data string, value any) error {
	return json.Unmarshal([]byte(data), value)
}
