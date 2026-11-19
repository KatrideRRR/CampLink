
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';

type Listener = {
    remove: () => Promise<void>;
};

export function installViewportTracking() {
    const update = () => {
        const viewport = window.visualViewport;

        if (!viewport) return;

        document.documentElement.style.setProperty(
            '--camplink-viewport-height',
            `${Math.round(viewport.height)}px`
        );

        document.documentElement.style.setProperty(
            '--camplink-viewport-top',
            `${Math.round(viewport.offsetTop)}px`
        );
    };

    update();

    window.visualViewport?.addEventListener(
        'resize',
        update
    );

    window.visualViewport?.addEventListener(
        'scroll',
        update
    );

    window.addEventListener('resize', update);
}

export function observeIosLifecycle(
    onResume: () => void
): () => void {
    if (
        !Capacitor.isNativePlatform() ||
        Capacitor.getPlatform() !== 'ios'
    ) {
        return () => {};
    }

    let disposed = false;
    const listeners: Listener[] = [];

    function register(
        pending: Promise<Listener>
    ) {
        void pending.then((listener) => {
            if (disposed) {
                void listener.remove();
            } else {
                listeners.push(listener);
            }
        }).catch((error) => {
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
                    onResume();
                }
            }
        )
    );

    register(
        Keyboard.addListener(
            'keyboardWillShow',
            () => {
                document.documentElement.classList.add(
                    'camplink-keyboard-open'
                );
            }
        )
    );

    register(
        Keyboard.addListener(
            'keyboardWillHide',
            () => {
                document.documentElement.classList.remove(
                    'camplink-keyboard-open'
                );
            }
        )
    );

    return () => {
        disposed = true;

        document.documentElement.classList.remove(
            'camplink-keyboard-open'
        );

        for (const listener of listeners) {
            void listener.remove();
        }
    };
}
