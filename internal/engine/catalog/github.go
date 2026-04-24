package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// githubRelease is the minimal subset of GitHub's release JSON we need.
type githubRelease struct {
	TagName    string        `json:"tag_name"`
	Prerelease bool          `json:"prerelease"`
	Assets     []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// fetchLatestRelease fetches https://api.github.com/repos/{owner}/{repo}/releases/latest
// and decodes it as githubRelease. Uses ctx for cancellation.
func fetchLatestRelease(ctx context.Context, owner, repo string) (githubRelease, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases/latest", owner, repo)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return githubRelease{}, fmt.Errorf("fetchLatestRelease %s/%s: %w", owner, repo, err)
	}
	req.Header.Set("User-Agent", "Masterboard/1.0")
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return githubRelease{}, fmt.Errorf("fetchLatestRelease %s/%s: %w", owner, repo, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return githubRelease{}, fmt.Errorf("fetchLatestRelease %s/%s: unexpected status %d", owner, repo, resp.StatusCode)
	}

	var rel githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return githubRelease{}, fmt.Errorf("fetchLatestRelease %s/%s: decode: %w", owner, repo, err)
	}
	return rel, nil
}

// fetchAllReleases fetches https://api.github.com/repos/{owner}/{repo}/releases
// (first page, up to 30 releases). Returns []githubRelease.
func fetchAllReleases(ctx context.Context, owner, repo string) ([]githubRelease, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/releases", owner, repo)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("fetchAllReleases %s/%s: %w", owner, repo, err)
	}
	req.Header.Set("User-Agent", "Masterboard/1.0")
	req.Header.Set("Accept", "application/vnd.github+json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetchAllReleases %s/%s: %w", owner, repo, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetchAllReleases %s/%s: unexpected status %d", owner, repo, resp.StatusCode)
	}

	var releases []githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, fmt.Errorf("fetchAllReleases %s/%s: decode: %w", owner, repo, err)
	}
	return releases, nil
}
