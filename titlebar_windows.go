//go:build windows

package main

import (
	"os"
	"syscall"
	"unsafe"
)

// WM_SETICON / LoadImageW constants
const (
	wmSetIcon      = 0x0080
	iconSmall      = 0
	iconBig        = 1
	imageIcon      = 1
	lrLoadFromFile = 0x00000010
	lrDefaultSize  = 0x00000040
)

var (
	modUser32        = syscall.NewLazyDLL("user32.dll")
	procFindWindowW  = modUser32.NewProc("FindWindowW")
	procSendMessageW = modUser32.NewProc("SendMessageW")
	procLoadImageW   = modUser32.NewProc("LoadImageW")
)

// setTitleBarTheme swaps the window icon (taskbar + title bar corner) to match
// the current theme. Dark mode shows the white icon so it stays visible
// against a dark taskbar; light mode shows the black icon for the opposite
// reason. With a frameless window there is no native caption to style, so DWM
// attribute calls are no longer needed.
func setTitleBarTheme(dark bool, blackIcon, whiteIcon []byte) {
	title, err := syscall.UTF16PtrFromString("Masterboard")
	if err != nil {
		return
	}
	hwnd, _, _ := procFindWindowW.Call(0, uintptr(unsafe.Pointer(title)))
	if hwnd == 0 {
		return
	}

	icon := blackIcon
	if dark {
		icon = whiteIcon
	}
	if len(icon) > 0 {
		setWindowIcon(hwnd, icon)
	}
}

// setWindowIcon sets the small and large window icons from raw PNG bytes.
// It wraps the PNG in a minimal ICO container, writes it to a temp file
// (LoadImageW requires a path), loads it, then sends WM_SETICON.
func setWindowIcon(hwnd uintptr, pngBytes []byte) {
	tmp, err := os.CreateTemp("", "mb*.ico")
	if err != nil {
		return
	}
	name := tmp.Name()
	defer os.Remove(name)
	tmp.Write(makeSinglePNGIco(pngBytes))
	tmp.Close()

	path, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return
	}
	hIcon, _, _ := procLoadImageW.Call(
		0,
		uintptr(unsafe.Pointer(path)),
		imageIcon,
		0, 0,
		lrLoadFromFile|lrDefaultSize,
	)
	if hIcon == 0 {
		return
	}
	procSendMessageW.Call(hwnd, wmSetIcon, iconSmall, hIcon)
	procSendMessageW.Call(hwnd, wmSetIcon, iconBig, hIcon)
}

// makeSinglePNGIco wraps PNG bytes in a minimal ICO file.
// Windows Vista+ supports PNG-compressed images inside ICO containers.
func makeSinglePNGIco(png []byte) []byte {
	out := make([]byte, 22+len(png))
	// ICONDIR: reserved=0, type=1 (icon), count=1
	out[2] = 1
	out[4] = 1
	// ICONDIRENTRY: bWidth=0 (256), bHeight=0 (256), bColorCount=0, bReserved=0
	//   wPlanes=1, wBitCount=32, dwBytesInRes=len(png), dwImageOffset=22
	out[10] = 1  // wPlanes
	out[12] = 32 // wBitCount
	n := uint32(len(png))
	out[14] = byte(n)
	out[15] = byte(n >> 8)
	out[16] = byte(n >> 16)
	out[17] = byte(n >> 24)
	out[18] = 22 // offset to PNG data
	copy(out[22:], png)
	return out
}
