(function () {
    'use strict';

    const STORAGE_KEY = 'preferredTheme';
    const LIGHT_THEME_COLOR = '#f4f9f7';
    const DARK_THEME_COLOR = '#050713';

    function isTheme(value) {
        return value === 'light' || value === 'dark';
    }

    function readSavedTheme() {
        try {
            const value = window.localStorage.getItem(STORAGE_KEY);
            return isTheme(value) ? value : null;
        } catch (error) {
            return null;
        }
    }

    function writeSavedTheme(theme) {
        try {
            window.localStorage.setItem(STORAGE_KEY, theme);
        } catch (error) {
            // A blocked storage API must not prevent the visual switch.
        }
    }

    function initBlogTheme() {
        const body = document.body;
        if (!body || !body.classList.contains('blog-page') || body.dataset.blogThemeReady === 'true') {
            return;
        }

        body.dataset.blogThemeReady = 'true';

        const root = document.documentElement;
        const buttons = Array.from(document.querySelectorAll('[data-theme-toggle]'));
        const themeColor = document.querySelector('meta[name="theme-color"]');
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');

        function syncControls(theme) {
            const isDark = theme === 'dark';

            buttons.forEach(function (button) {
                button.setAttribute('aria-pressed', String(isDark));
                button.setAttribute(
                    'aria-label',
                    isDark ? 'Switch to light laboratory theme' : 'Switch to dark cosmic theme'
                );
                button.setAttribute(
                    'title',
                    isDark ? 'Switch to light laboratory theme' : 'Switch to dark cosmic theme'
                );

                const label = button.querySelector('.theme-toggle-label');
                if (label) {
                    label.textContent = isDark ? 'COSMOS MODE' : 'LAB MODE';
                }
            });
        }

        function emitThemeChange(theme) {
            try {
                window.dispatchEvent(new CustomEvent('themechange', {
                    detail: { theme: theme }
                }));
            } catch (error) {
                // CustomEvent is progressive enhancement; the theme is already applied.
            }
        }

        function applyTheme(theme, options) {
            const nextTheme = theme === 'dark' ? 'dark' : 'light';
            const settings = options || {};

            root.dataset.theme = nextTheme;
            root.style.colorScheme = nextTheme;

            if (themeColor) {
                themeColor.setAttribute(
                    'content',
                    nextTheme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR
                );
            }

            syncControls(nextTheme);

            if (settings.persist) {
                writeSavedTheme(nextTheme);
            }

            if (settings.emit !== false) {
                emitThemeChange(nextTheme);
            }
        }

        const initialTheme = isTheme(root.dataset.theme)
            ? root.dataset.theme
            : (readSavedTheme() || (systemTheme.matches ? 'dark' : 'light'));

        applyTheme(initialTheme, { emit: false });

        buttons.forEach(function (button) {
            button.addEventListener('click', function () {
                const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
                applyTheme(nextTheme, { persist: true });
            });
        });

        function handleSystemThemeChange(event) {
            if (!readSavedTheme()) {
                applyTheme(event.matches ? 'dark' : 'light');
            }
        }

        if (typeof systemTheme.addEventListener === 'function') {
            systemTheme.addEventListener('change', handleSystemThemeChange);
        } else if (typeof systemTheme.addListener === 'function') {
            systemTheme.addListener(handleSystemThemeChange);
        }

        window.addEventListener('storage', function (event) {
            if (event.key !== STORAGE_KEY) {
                return;
            }

            if (isTheme(event.newValue)) {
                applyTheme(event.newValue);
            } else if (event.newValue === null) {
                applyTheme(systemTheme.matches ? 'dark' : 'light');
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBlogTheme, { once: true });
    } else {
        initBlogTheme();
    }
}());
