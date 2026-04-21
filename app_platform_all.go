package main

import "runtime"

func (a *App) GetPlatformInfo() string {
	return runtime.GOOS
}
