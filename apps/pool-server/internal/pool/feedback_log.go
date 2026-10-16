package pool

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
)

func appendFeedbackJSONL(path string, feedback TaskFeedback) error {
	if stringsTrim(path) == "" {
		return nil
	}
	dir := filepath.Dir(path)
	if dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	payload, err := json.Marshal(feedback)
	if err != nil {
		return err
	}
	if _, err := file.Write(append(payload, '\n')); err != nil {
		return err
	}
	return file.Sync()
}

func feedbackIdentity(f TaskFeedback) string {
	raw := f.Owner.ClientID + "|" + f.Owner.AccountID + "|" + f.LotteryID + "|" + f.Event
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func readFeedbackLog(filePath string) []TaskFeedback {
	file, err := os.Open(filePath)
	if err != nil {
		return nil
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 4096), 8*1024*1024)
	var out []TaskFeedback
	for scanner.Scan() {
		var item TaskFeedback
		if json.Unmarshal(scanner.Bytes(), &item) == nil {
			out = append(out, item)
		}
	}
	return out
}
