package utils

import (
	"fmt"
	"time"
)

func FormatAntimonyLog(messageParts ...string) string {
	logMessage := messageParts[0] + " "
	for i := 1; i < len(messageParts); i += 2 {
		if i+1 < len(messageParts) {
			logMessage += fmt.Sprintf("%s=%s ", messageParts[i], messageParts[i+1])
		} else {
			logMessage += messageParts[i]
		}
	}

	return fmt.Sprintf("%s ANTIMONY %s", time.Now().Format(time.TimeOnly), logMessage)
}
