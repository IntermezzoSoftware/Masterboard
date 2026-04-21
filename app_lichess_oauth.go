package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const lichessRedirectURI = "io.masterboard.app://oauth/callback"

// oauthCallbackPath returns the temp file used to pass the callback URL from
// the OS-launched second instance back to the running app. Both instances share
// os.TempDir(), so this works across the process boundary on every platform.
func oauthCallbackPath() string {
	return filepath.Join(os.TempDir(), "masterboard-oauth-callback.url")
}

func (a *App) LichessOAuthConnect() error {
	verifier, challenge, err := generatePKCE()
	if err != nil {
		return fmt.Errorf("generate PKCE: %w", err)
	}

	// Remove any stale callback file left by a previous interrupted flow.
	os.Remove(oauthCallbackPath())

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	a.oauthMu.Lock()
	a.oauthCancel = cancel
	a.oauthMu.Unlock()
	defer func() {
		cancel()
		a.oauthMu.Lock()
		a.oauthCancel = nil
		a.oauthMu.Unlock()
	}()

	params := url.Values{}
	params.Set("response_type", "code")
	params.Set("client_id", "masterboard")
	params.Set("redirect_uri", lichessRedirectURI)
	params.Set("scope", "study:read")
	params.Set("code_challenge", challenge)
	params.Set("code_challenge_method", "S256")
	wailsRuntime.BrowserOpenURL(a.ctx, "https://lichess.org/oauth?"+params.Encode())

	// Poll for the callback file. On Windows, the OS launches a new process with
	// the callback URL as os.Args[1]; that process writes the file and exits
	// immediately (see main.go). On Mac, OnUrlOpen calls handleOAuthCallback
	// which writes the same file. Either way this loop picks it up.
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	var callbackURL string
	for callbackURL == "" {
		select {
		case <-ctx.Done():
			if ctx.Err() == context.Canceled {
				return fmt.Errorf("cancelled")
			}
			return fmt.Errorf("timed out waiting for Lichess authorization (5 min)")
		case <-ticker.C:
			if data, readErr := os.ReadFile(oauthCallbackPath()); readErr == nil && len(data) > 0 {
				callbackURL = string(data)
				os.Remove(oauthCallbackPath())
			}
		}
	}

	u, err := url.Parse(callbackURL)
	if err != nil {
		return fmt.Errorf("parse callback URL: %w", err)
	}
	if u.Query().Get("error") != "" {
		return fmt.Errorf("cancelled")
	}
	code := u.Query().Get("code")
	if code == "" {
		return fmt.Errorf("no code in callback")
	}

	token, err := lichessExchangeCode(code, verifier, lichessRedirectURI)
	if err != nil {
		return fmt.Errorf("exchange code: %w", err)
	}
	username, err := lichessFetchUsername(token)
	if err != nil {
		return fmt.Errorf("fetch username: %w", err)
	}
	if err := a.db.SetSetting("lichess.oauth_token", token); err != nil {
		return fmt.Errorf("store token: %w", err)
	}
	return a.db.SetSetting("lichess.oauth_username", username)
}

func (a *App) LichessOAuthDisconnect() error {
	if err := a.db.SetSetting("lichess.oauth_token", ""); err != nil {
		return err
	}
	return a.db.SetSetting("lichess.oauth_username", "")
}

func (a *App) LichessOAuthCancel() {
	a.oauthMu.Lock()
	cancel := a.oauthCancel
	a.oauthMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// handleOAuthCallback is called by Mac's OnUrlOpen when Lichess redirects to
// io.masterboard.app://oauth/callback after the user authorizes or cancels.
// It writes the URL to the temp file that LichessOAuthConnect polls.
func (a *App) handleOAuthCallback(rawURL string) {
	if !strings.HasPrefix(rawURL, "io.masterboard.app://") {
		return
	}
	if err := os.WriteFile(oauthCallbackPath(), []byte(rawURL), 0600); err != nil {
		log.Printf("handleOAuthCallback: %v", err)
	}
}

func (a *App) LichessOAuthStatus() (string, error) {
	token, err := a.db.GetSetting("lichess.oauth_token")
	if err != nil || token == "" {
		return "", err
	}
	return a.db.GetSetting("lichess.oauth_username")
}

func generatePKCE() (verifier, challenge string, err error) {
	b := make([]byte, 64)
	if _, err = rand.Read(b); err != nil {
		return
	}
	verifier = base64.RawURLEncoding.EncodeToString(b)
	h := sha256.Sum256([]byte(verifier))
	challenge = base64.RawURLEncoding.EncodeToString(h[:])
	return
}

func lichessExchangeCode(code, verifier, redirectURI string) (string, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("client_id", "masterboard")
	form.Set("code_verifier", verifier)

	resp, err := http.Post(
		"https://lichess.org/api/token",
		"application/x-www-form-urlencoded",
		strings.NewReader(form.Encode()),
	)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token exchange failed (%d): %s", resp.StatusCode, body)
	}
	var result struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(body, &result); err != nil || result.AccessToken == "" {
		return "", fmt.Errorf("invalid token response: %s", body)
	}
	return result.AccessToken, nil
}

func lichessFetchUsername(token string) (string, error) {
	req, err := http.NewRequest("GET", "https://lichess.org/api/account", nil)
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("fetch account failed (%d): %s", resp.StatusCode, body)
	}
	var result struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	return result.Username, nil
}
