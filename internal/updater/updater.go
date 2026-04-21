// Package updater checks GitHub Releases for a newer version of Masterboard.
package updater

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const releaseURL = "https://api.github.com/repos/IntermezzoSoftware/Masterboard/releases/latest"

// CheckForUpdate queries the GitHub Releases API and returns the latest
// version tag if it is newer than currentVersion, or "" if already current.
// currentVersion and the tag_name are expected to be semver strings like
// "0.1.0" or "v0.1.0" (the "v" prefix is stripped before comparison).
func CheckForUpdate(currentVersion string) (string, error) {
	client := &http.Client{Timeout: 8 * time.Second}
	req, err := http.NewRequest("GET", releaseURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Masterboard-updater")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("github api returned %d", resp.StatusCode)
	}

	var release struct {
		TagName    string `json:"tag_name"`
		Prerelease bool   `json:"prerelease"`
		Draft      bool   `json:"draft"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return "", err
	}

	if release.Draft || release.Prerelease {
		return "", nil
	}

	latest := strings.TrimPrefix(release.TagName, "v")
	current := strings.TrimPrefix(currentVersion, "v")

	if isNewer(latest, current) {
		return latest, nil
	}
	return "", nil
}

// isNewer returns true if candidate is semantically newer than base.
// Both are expected in MAJOR.MINOR.PATCH format.
func isNewer(candidate, base string) bool {
	cv := parseSemver(candidate)
	bv := parseSemver(base)
	for i := range cv {
		if cv[i] > bv[i] {
			return true
		}
		if cv[i] < bv[i] {
			return false
		}
	}
	return false
}

func parseSemver(v string) [3]int {
	var parts [3]int
	segs := strings.SplitN(v, ".", 3)
	for i, s := range segs {
		if i >= 3 {
			break
		}
		n, _ := strconv.Atoi(s)
		parts[i] = n
	}
	return parts
}
