import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { Network } from '@capacitor/network';

type Listener = {
    remove: () => Promise<void>;
};

let nativeKeyboardHeight = 0;
let expandedHeight = 0;

function updateViewport() {
    const viewport = window.visualViewport;

    const visibleHeight =
        viewport?.height ?? window.innerHeight;

    if (nativeKeyboardHeight === 0) {
        expandedHeight = Math.max(
            visibleHeight,
            window.innerHeight
        );
    }

    const fallbackHeight = Math.max(
        200,
        expandedHeight - nativeKeyboardHeight
    );

    const height = nativeKeyboardHeight > 0
        ? Math.min(visibleHeight, fallbackHeight)
        : visibleHeight;

    document.documentElement.style.setProperty(
        '--camplink-viewport-height',
        `${Math.round(height)}px`
    );

    document.documentElement.style.setProperty(
        '--camplink-viewport-top',
        `${Math.round(viewport?.offsetTop ?? 0)}px`
    );
}

function updateKeyboardHeight(height: number) {
    nativeKeyboardHeight =
        Number.isFinite(height) && height > 0
            ? height
            : 0;

    updateViewport();

    window.requestAnimationFrame(updateViewport);
    window.setTimeout(updateViewport, 100);
    window.setTimeout(updateViewport, 400);
}

export function installViewportTracking() {
    updateViewport();

    window.visualViewport?.addEventListener(
        'resize',
        updateViewport
    );

    window.visualViewport?.addEventListener(
        'scroll',
        updateViewport
    );

    window.addEventListener(
        'resize',
        updateViewport
    );

    window.addEventListener(
        'orientationchange',
        updateViewport
    );
}

export function observeIosLifecycle(
    onResume: () => void,
    onKeyboardSettled: () => void,
    onNetworkChange: (connected: boolean) => void,
    onKeyboardWillChange: () => void = () => {}
): () => void {
    if (
        !Capacitor.isNativePlatform() ||
        Capacitor.getPlatform() !== 'ios'
    ) {
        return () => {};
    }

    let disposed = false;
    const listeners: Listener[] = [];

    function register(pending: Promise<Listener>) {
        void pending.then(listener => {
            if (disposed) {
                void listener.remove();
            } else {
                listeners.push(listener);
            }
        }).catch(error => {
            console.warn(
                'CampLink native listener unavailable',
                error
            );
        });
    }

    register(
        NativeApp.addListener(
            'appStateChange',
            ({ isActive }) => {
                if (isActive) {
                    updateViewport();
                    onResume();
                }
            }
        )
    );

    register(
        Keyboard.addListener(
            'keyboardWillShow',
            info => {
                onKeyboardWillChange();

                document.documentElement.classList.add(
                    'camplink-keyboard-open'
                );

                updateKeyboardHeight(
                    info.keyboardHeight
                );
            }
        )
    );

    register(
        Keyboard.addListener(
            'keyboardDidShow',
            info => {
                updateKeyboardHeight(
                    info.keyboardHeight
                );
                onKeyboardSettled();
            }
        )
    );

    register(
        Keyboard.addListener(
            'keyboardWillHide',
            onKeyboardWillChange
        )
    );

    register(
        Keyboard.addListener(
            'keyboardDidHide',
            () => {
                document.documentElement.classList.remove(
                    'camplink-keyboard-open'
                );

                updateKeyboardHeight(0);
                onKeyboardSettled();
            }
        )
    );

    register(
        Network.addListener(
            'networkStatusChange',
            ({ connected }) => {
                onNetworkChange(connected);
            }
        )
    );

    return () => {
        disposed = true;
        updateKeyboardHeight(0);

        document.documentElement.classList.remove(
            'camplink-keyboard-open'
        );

        for (const listener of listeners) {
            void listener.remove();
        }
    };
}
