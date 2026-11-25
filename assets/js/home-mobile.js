/*
 * Homepage — phone behaviours: the app bar condenses once the name has
 * scrolled away, the research deck gets a pager, the journey's segmented
 * control follows the swipeable panes, and the stage HUD runs a clock.
 * Progressive enhancement only: without it the sections still scroll and
 * swipe. Desktop never shows these controls (CSS), so the handlers idle.
 */
(function () {
    'use strict';

    const mobileQuery = window.matchMedia('(max-width: 767px)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function scrollBehavior() {
        return reducedMotion.matches ? 'auto' : 'smooth';
    }

    /* Horizontal snap tracks: the item closest to the track's start edge. */
    function trackOrigin(track) {
        const style = window.getComputedStyle(track);
        return track.getBoundingClientRect().left + (parseFloat(style.paddingLeft) || 0);
    }

    function nearestIndex(track, items) {
        const maxScroll = track.scrollWidth - track.clientWidth;
        if (maxScroll > 2 && track.scrollLeft >= maxScroll - 2) return items.length - 1;
        const origin = trackOrigin(track);
        let best = 0;
        let bestDistance = Infinity;
        items.forEach((item, index) => {
            const distance = Math.abs(item.getBoundingClientRect().left - origin);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = index;
            }
        });
        return best;
    }

    function scrollToItem(track, item) {
        const left = track.scrollLeft + item.getBoundingClientRect().left - trackOrigin(track);
        track.scrollTo({ left, behavior: scrollBehavior() });
    }

    function onScrollFrame(target, callback) {
        let pending = false;
        target.addEventListener('scroll', () => {
            if (pending) return;
            pending = true;
            window.requestAnimationFrame(() => {
                pending = false;
                callback();
            });
        }, { passive: true });
    }

    function pad(value) {
        return String(value).padStart(2, '0');
    }

    function initAppBar() {
        const bar = document.getElementById('lang-switcher-mobile');
        const name = document.querySelector('#home h1');
        if (!bar || !name || typeof IntersectionObserver !== 'function') return;
        const observer = new IntersectionObserver(entries => {
            const entry = entries[entries.length - 1];
            const scrolledPast = !entry.isIntersecting && entry.boundingClientRect.top < 80;
            bar.classList.toggle('is-condensed', scrolledPast);
        }, { rootMargin: '-56px 0px 0px 0px' });
        observer.observe(name);
    }

    function initPager(pager) {
        const track = document.querySelector(pager.dataset.pagerFor);
        if (!track) return;
        const items = Array.from(track.children);
        if (items.length < 2) return;
        const dots = items.map((item, index) => {
            const button = document.createElement('button');
            const title = item.querySelector('h3');
            button.type = 'button';
            button.setAttribute('aria-label', `${index + 1} / ${items.length}` +
                (title ? ` · ${title.textContent.replace(/\s+/g, ' ').trim()}` : ''));
            button.addEventListener('click', () => scrollToItem(track, item));
            pager.appendChild(button);
            return button;
        });
        const count = document.createElement('span');
        count.className = 'm-pager-count';
        count.setAttribute('aria-hidden', 'true');
        pager.appendChild(count);

        const update = () => {
            const active = nearestIndex(track, items);
            dots.forEach((dot, index) => dot.setAttribute('aria-current', String(index === active)));
            count.textContent = `${pad(active + 1)} / ${pad(items.length)}`;
        };
        onScrollFrame(track, update);
        window.addEventListener('resize', update, { passive: true });
        update();
    }

    function initSegment() {
        const segment = document.querySelector('#journey .m-segment');
        const track = document.querySelector('#journey .journey-panes');
        if (!segment || !track) return;
        const buttons = Array.from(segment.querySelectorAll('[data-journey-tab]'));
        const panes = Array.from(track.children);
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                const pane = panes[Number(button.dataset.journeyTab)];
                if (pane) scrollToItem(track, pane);
            });
        });

        /* The thumb follows the finger: position = scroll / pane stride. */
        const update = () => {
            if (!mobileQuery.matches || panes.length < 2) return;
            const gap = parseFloat(window.getComputedStyle(track).columnGap) || 0;
            const stride = panes[0].getBoundingClientRect().width + gap;
            if (stride <= 0) return;
            const maxScroll = track.scrollWidth - track.clientWidth;
            const atEnd = maxScroll > 2 && track.scrollLeft >= maxScroll - 2;
            const position = atEnd ? panes.length - 1 : Math.min(panes.length - 1, Math.max(0, track.scrollLeft / stride));
            segment.style.setProperty('--seg-pos', position.toFixed(3));
            const active = Math.round(position);
            buttons.forEach((button, index) => button.setAttribute('aria-current', String(index === active)));
        };
        onScrollFrame(track, update);
        window.addEventListener('resize', update, { passive: true });
        update();
    }

    /* "REC" clock on the stage: time on the page, ticking only while the
     * stage is visible on a phone. */
    function initHudClock() {
        const clock = document.querySelector('[data-hud-clock]');
        if (!clock) return;
        const startedAt = Date.now();
        let timer = null;
        let visible = true;

        const tick = () => {
            const seconds = Math.floor((Date.now() - startedAt) / 1000);
            clock.textContent = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
        };
        const halt = () => {
            if (timer === null) return;
            window.clearInterval(timer);
            timer = null;
        };
        const sync = () => {
            if (visible && mobileQuery.matches && !document.hidden) {
                if (timer !== null) return;
                tick();
                timer = window.setInterval(tick, 1000);
            } else {
                halt();
            }
        };

        if (typeof IntersectionObserver === 'function') {
            new IntersectionObserver(entries => {
                visible = entries[entries.length - 1].isIntersecting;
                sync();
            }).observe(clock);
        }
        document.addEventListener('visibilitychange', sync);
        if (typeof mobileQuery.addEventListener === 'function') {
            mobileQuery.addEventListener('change', sync);
        }
        sync();
    }

    function init() {
        initAppBar();
        document.querySelectorAll('.m-pager[data-pager-for]').forEach(initPager);
        initSegment();
        initHudClock();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
}());
