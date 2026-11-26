#!/usr/bin/env python3
"""
Vehicle side-slip angle estimation: Extended vs. Unscented Kalman Filter.

Companion script to the blog post "Chasing an Invisible Angle" on my B.Sc.
thesis (University of Siegen, 2022). It reproduces every number and figure
in the post.

Ground truth
    Nonlinear single-track ("bicycle") model with Magic Formula tyres and a
    tyre relaxation length, integrated with RK4 at 1 kHz.
Sensors (100 Hz, ESC-type cluster)
    yaw-rate gyro, lateral accelerometer, wheel-speed based v_x and the
    steering-wheel angle, each with white noise; gyro and accelerometer also
    carry a constant per-run bias.
Estimators
    EKF and UKF on x = [beta, r] with the same process model, the same Q/R
    and deliberately imperfect tyre parameters (the truth is never known
    exactly). A kinematic integrator (beta_dot = a_y / v_x - r) serves as the
    "why not just integrate?" baseline.

Usage
    python3 sideslip_ekf_ukf.py                 # all three experiments
    python3 sideslip_ekf_ukf.py --runs 100      # more runs
    python3 sideslip_ekf_ukf.py --export out.json
"""
import argparse
import json
import time

import numpy as np

G = 9.81
DT_TRUTH = 1e-3          # plant integration step [s]
DT = 1e-2                # sensor / estimator step [s]
STEER_RATIO = 16.0       # steering wheel -> road wheel
DEG = np.pi / 180.0

TRUE = dict(m=1500.0, Iz=2600.0, lf=1.18, lr=1.42, mu=1.0,
            Bf=12.0, Cf=1.3, Ef=-0.5,
            Br=13.5, Cr=1.3, Er=-0.5,
            relax=0.6)                       # tyre relaxation length [m]

# What the estimators believe: tyre stiffness identified with a few percent
# error and no relaxation dynamics.
MODEL = dict(TRUE, Bf=TRUE['Bf'] * 0.94, Br=TRUE['Br'] * 1.04)

SENSOR = dict(gyro_noise=0.25 * DEG, gyro_bias=0.15 * DEG,     # rad/s
              acc_noise=0.15, acc_bias=0.05,                   # m/s^2
              speed_noise=0.05,                                # m/s
              swa_noise=0.2 * DEG)                             # rad (steering wheel)


def axle_loads(p):
    L = p['lf'] + p['lr']
    return p['m'] * G * p['lr'] / L, p['m'] * G * p['lf'] / L


def magic_formula(alpha, B, C, E, Fz, mu=1.0):
    """Pacejka 'Magic Formula' lateral force of one axle.

    Friction enters through the similarity method: the peak force scales
    with mu while the cornering stiffness B*C*Fz stays the same, so a wet
    road looks identical to a dry one until the tyres approach their limit.
    """
    Ba = B * alpha / mu
    return mu * Fz * np.sin(C * np.arctan(Ba - E * (Ba - np.arctan(Ba))))


def tyre_forces(alpha_f, alpha_r, p):
    Fzf, Fzr = axle_loads(p)
    Fyf = magic_formula(alpha_f, p['Bf'], p['Cf'], p['Ef'], Fzf, p['mu'])
    Fyr = magic_formula(alpha_r, p['Br'], p['Cr'], p['Er'], Fzr, p['mu'])
    return Fyf, Fyr


# --------------------------------------------------------------------------
# Ground-truth plant
# --------------------------------------------------------------------------
def plant_derivative(s, delta, vx, p):
    """s = [vy, r, alpha_f, alpha_r, psi, X, Y]."""
    vy, r, af, ar, psi = s[0], s[1], s[2], s[3], s[4]
    af_kin = delta - np.arctan((vy + p['lf'] * r) / vx)
    ar_kin = -np.arctan((vy - p['lr'] * r) / vx)
    Fyf, Fyr = tyre_forces(af, ar, p)
    k = vx / p['relax']
    return np.array([
        (Fyf * np.cos(delta) + Fyr) / p['m'] - vx * r,
        (p['lf'] * Fyf * np.cos(delta) - p['lr'] * Fyr) / p['Iz'],
        k * (af_kin - af),
        k * (ar_kin - ar),
        r,
        vx * np.cos(psi) - vy * np.sin(psi),
        vx * np.sin(psi) + vy * np.cos(psi),
    ])


def simulate_truth(maneuver, p):
    duration, vx = maneuver['duration'], maneuver['vx']
    n = int(round(duration / DT_TRUTH))
    s = np.zeros(7)
    every = int(round(DT / DT_TRUTH))
    out = {k: [] for k in ('t', 'swa', 'delta', 'vy', 'r', 'ay', 'beta', 'X', 'Y', 'psi')}

    def record(t, s, delta):
        Fyf, Fyr = tyre_forces(s[2], s[3], p)
        out['t'].append(t)
        out['swa'].append(delta * STEER_RATIO)
        out['delta'].append(delta)
        out['vy'].append(s[0])
        out['r'].append(s[1])
        out['ay'].append((Fyf * np.cos(delta) + Fyr) / p['m'])
        out['beta'].append(np.arctan(s[0] / vx))
        out['X'].append(s[5])
        out['Y'].append(s[6])
        out['psi'].append(s[4])

    steer = maneuver['steer']
    for i in range(n + 1):
        t = i * DT_TRUTH
        if i % every == 0:
            record(t, s, steer(t) / STEER_RATIO)
        if i == n:
            break
        d0 = steer(t) / STEER_RATIO
        dh = steer(t + DT_TRUTH / 2) / STEER_RATIO
        d1 = steer(t + DT_TRUTH) / STEER_RATIO
        k1 = plant_derivative(s, d0, vx, p)
        k2 = plant_derivative(s + DT_TRUTH / 2 * k1, dh, vx, p)
        k3 = plant_derivative(s + DT_TRUTH / 2 * k2, dh, vx, p)
        k4 = plant_derivative(s + DT_TRUTH * k3, d1, vx, p)
        s = s + DT_TRUTH / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
    truth = {k: np.asarray(v) for k, v in out.items()}
    truth['vx'] = np.full_like(truth['t'], vx)
    return truth


def measure(truth, rng):
    n = truth['t'].size
    gyro_bias = rng.normal(0.0, SENSOR['gyro_bias'])
    acc_bias = rng.normal(0.0, SENSOR['acc_bias'])
    return dict(
        r=truth['r'] + gyro_bias + rng.normal(0.0, SENSOR['gyro_noise'], n),
        ay=truth['ay'] + acc_bias + rng.normal(0.0, SENSOR['acc_noise'], n),
        vx=truth['vx'] + rng.normal(0.0, SENSOR['speed_noise'], n),
        delta=(truth['swa'] + rng.normal(0.0, SENSOR['swa_noise'], n)) / STEER_RATIO,
    )


# --------------------------------------------------------------------------
# Estimator model: x = [beta, r], u = [delta, vx], y = [r, a_y]
# --------------------------------------------------------------------------
def model_forces(x, u, p=MODEL):
    beta, r = x
    delta, vx = u
    tb = np.tan(beta)
    af = delta - np.arctan(tb + p['lf'] * r / vx)
    ar = -np.arctan(tb - p['lr'] * r / vx)
    return tyre_forces(af, ar, p)


def model_derivative(x, u, p=MODEL):
    beta, r = x
    delta, vx = u
    Fyf, Fyr = model_forces(x, u, p)
    vy_dot = (Fyf * np.cos(delta) + Fyr) / p['m'] - vx * r
    return np.array([np.cos(beta) ** 2 * vy_dot / vx,
                     (p['lf'] * Fyf * np.cos(delta) - p['lr'] * Fyr) / p['Iz']])


def f(x, u):
    """One estimator step: RK4 over DT with the input held."""
    k1 = model_derivative(x, u)
    k2 = model_derivative(x + DT / 2 * k1, u)
    k3 = model_derivative(x + DT / 2 * k2, u)
    k4 = model_derivative(x + DT * k3, u)
    return x + DT / 6 * (k1 + 2 * k2 + 2 * k3 + k4)


def h(x, u):
    Fyf, Fyr = model_forces(x, u)
    return np.array([x[1], (Fyf * np.cos(u[0]) + Fyr) / MODEL['m']])


def jacobian(fun, x, u, eps=1e-6):
    cols = []
    for i in range(x.size):
        dx = np.zeros_like(x)
        dx[i] = eps
        cols.append((fun(x + dx, u) - fun(x - dx, u)) / (2 * eps))
    return np.column_stack(cols)


Q = np.diag([(0.05 * DEG) ** 2, (0.15 * DEG) ** 2])
# The accelerometer channel is inflated by 0.3 m/s^2 to cover tyre-model error.
R = np.diag([SENSOR['gyro_noise'] ** 2 + SENSOR['gyro_bias'] ** 2,
             SENSOR['acc_noise'] ** 2 + SENSOR['acc_bias'] ** 2 + 0.3 ** 2])
P0 = np.diag([(1.0 * DEG) ** 2, (1.0 * DEG) ** 2])


class EKF:
    name = 'EKF'

    def __init__(self, x0, P0=P0, Q=Q):
        self.x, self.P, self.Q = x0.copy(), P0.copy(), Q

    def step(self, u_prev, u, y):
        F = jacobian(f, self.x, u_prev)
        self.x = f(self.x, u_prev)
        self.P = F @ self.P @ F.T + self.Q
        H = jacobian(h, self.x, u)
        S = H @ self.P @ H.T + R
        K = self.P @ H.T @ np.linalg.inv(S)
        self.x = self.x + K @ (y - h(self.x, u))
        I_KH = np.eye(2) - K @ H
        self.P = I_KH @ self.P @ I_KH.T + K @ R @ K.T      # Joseph form


class UKF:
    name = 'UKF'
    alpha, beta_ut, kappa = 1.0, 2.0, 1.0                    # n + lambda = 3

    def __init__(self, x0, P0=P0, Q=Q):
        self.x, self.P, self.Q = x0.copy(), P0.copy(), Q
        n = x0.size
        self.lam = self.alpha ** 2 * (n + self.kappa) - n
        self.c = n + self.lam
        self.wm = np.full(2 * n + 1, 0.5 / self.c)
        self.wc = self.wm.copy()
        self.wm[0] = self.lam / self.c
        self.wc[0] = self.lam / self.c + (1 - self.alpha ** 2 + self.beta_ut)

    def sigma_points(self, x, P):
        A = np.linalg.cholesky(self.c * P)
        return np.vstack([x, x + A.T, x - A.T])

    def step(self, u_prev, u, y):
        X = np.array([f(s, u_prev) for s in self.sigma_points(self.x, self.P)])
        x_pred = self.wm @ X
        dX = X - x_pred
        P_pred = (self.wc[:, None] * dX).T @ dX + self.Q
        X = self.sigma_points(x_pred, P_pred)
        Y = np.array([h(s, u) for s in X])
        y_pred = self.wm @ Y
        dY = Y - y_pred
        dX = X - x_pred
        S = (self.wc[:, None] * dY).T @ dY + R
        Pxy = (self.wc[:, None] * dX).T @ dY
        K = Pxy @ np.linalg.inv(S)
        self.x = x_pred + K @ (y - y_pred)
        self.P = P_pred - K @ S @ K.T
        self.P = 0.5 * (self.P + self.P.T)


def run_filter(cls, meas, k0=0, P0=P0, Q=Q):
    """Run an estimator from sample k0 on, starting from beta = 0."""
    n = meas['r'].size
    est = cls(np.array([0.0, meas['r'][k0]]), P0=P0, Q=Q)
    beta, sd = np.full(n, np.nan), np.full(n, np.nan)
    beta[k0], sd[k0] = est.x[0], np.sqrt(est.P[0, 0])
    cost = 0.0
    for k in range(k0 + 1, n):
        u_prev = np.array([meas['delta'][k - 1], meas['vx'][k - 1]])
        u = np.array([meas['delta'][k], meas['vx'][k]])
        y = np.array([meas['r'][k], meas['ay'][k]])
        t0 = time.perf_counter()
        est.step(u_prev, u, y)
        cost += time.perf_counter() - t0
        beta[k], sd[k] = est.x[0], np.sqrt(max(est.P[0, 0], 0.0))
    return beta, sd, cost / max(n - 1 - k0, 1)


def run_kinematic(meas):
    beta = np.zeros(meas['r'].size)
    for k in range(1, beta.size):
        beta[k] = beta[k - 1] + DT * (meas['ay'][k - 1] / meas['vx'][k - 1] - meas['r'][k - 1])
    return beta


# --------------------------------------------------------------------------
# Manoeuvres (steering-wheel angle in rad as a function of time)
# --------------------------------------------------------------------------
def slalom(amplitude_deg, freq, t0, t1):
    def steer(t):
        if t < t0 or t > t1:
            return 0.0
        return amplitude_deg * DEG * np.sin(2 * np.pi * freq * (t - t0))
    return steer


def sine_with_dwell(amplitude_deg, t0, freq=0.7, dwell=0.5):
    """FMVSS 126 style: 0.7 Hz sine, 500 ms dwell at the second peak."""
    A = amplitude_deg * DEG
    t_peak = t0 + 0.75 / freq

    def steer(t):
        if t < t0:
            return 0.0
        if t < t_peak:
            return A * np.sin(2 * np.pi * freq * (t - t0))
        if t < t_peak + dwell:
            return -A
        if t < t_peak + dwell + 0.25 / freq:
            return A * np.sin(2 * np.pi * freq * (t - dwell - t0))
        return 0.0
    return steer


def ramp(rate_deg, t0, hold_at):
    def steer(t):
        return max(0.0, min(rate_deg * (t - t0), hold_at)) * DEG
    return steer


MANEUVERS = [
    dict(key='slalom', name='Slalom', vx=20.0, duration=12.0,
         steer=slalom(30.0, 0.5, 1.0, 11.0), mu=1.0,
         note='72 km/h, \u00b130\u00b0 at the steering wheel, 0.5 Hz: everyday driving, tyres in their linear range.'),
    dict(key='dwell', name='Sine with dwell', vx=80 / 3.6, duration=6.0,
         steer=sine_with_dwell(70.0, 1.0), mu=1.0,
         note='80 km/h, 70\u00b0 ESC-test profile (0.7 Hz sine, 0.5 s dwell): the rear lets go and the car nearly spins.'),
    dict(key='ramp', name='Ramp steer', vx=80 / 3.6, duration=13.0,
         steer=ramp(9.0, 1.0, 90.0), mu=1.0,
         note='80 km/h, steering wound up at 9\u00b0/s: lateral acceleration sweeps from zero to the friction limit.'),
    dict(key='wet', name='Wet road', vx=20.0, duration=12.0,
         steer=slalom(45.0, 0.5, 1.0, 11.0), mu=0.5,
         note='A slalom on a wet road (\u03bc = 0.5) while both filters still assume dry asphalt (\u03bc = 1).'),
]


MANOEUVRE = {m['key']: m for m in MANEUVERS}


def truth_for(man):
    return simulate_truth(man, dict(TRUE, mu=man['mu']))


def errors(beta, sd, truth, mask=None):
    ok = ~np.isnan(beta)
    if mask is not None:
        ok &= mask
    if not ok.any():
        return None
    err = (beta[ok] - truth['beta'][ok]) / DEG
    return dict(rmse=float(np.sqrt(np.mean(err ** 2))),
                max=float(np.max(np.abs(err))),
                cover=float(np.mean(np.abs(err) <= 2 * sd[ok] / DEG)))


def mean_std(values):
    return [round(float(np.mean(values)), 4), round(float(np.std(values)), 4)] if values else None


# --------------------------------------------------------------------------
# Experiment 1: every manoeuvre, filters running from standstill
# --------------------------------------------------------------------------
def experiment_nominal(runs):
    table = {}
    for man in MANEUVERS:
        truth = truth_for(man)
        near_limit = np.abs(truth['ay']) >= 6.0
        acc = {n: {'rmse': [], 'max': [], 'cover': [], 'limit': [], 'us': []} for n in ('EKF', 'UKF')}
        for seed in range(runs):
            meas = measure(truth, np.random.default_rng(1000 + seed))
            for cls in (EKF, UKF):
                beta, sd, cost = run_filter(cls, meas)
                e = errors(beta, sd, truth)
                hi = errors(beta, sd, truth, near_limit)
                a = acc[cls.name]
                a['rmse'].append(e['rmse'])
                a['max'].append(e['max'])
                a['cover'].append(e['cover'])
                a['us'].append(cost * 1e6)
                if hi:
                    a['limit'].append(hi['rmse'])
        row = {n: {k: mean_std(v) for k, v in a.items()} for n, a in acc.items()}
        row['peak'] = dict(beta=round(float(np.max(np.abs(truth['beta'])) / DEG), 2),
                           ay=round(float(np.max(np.abs(truth['ay']))), 2))
        table[man['key']] = row
    return table


# --------------------------------------------------------------------------
# Experiment 2: estimator (re)started at the friction limit with beta = 0
# --------------------------------------------------------------------------
RESTARTS = [dict(key='ramp', start=10.0), dict(key='dwell', start=3.0)]
RESTART_P0 = [1.0, 2.0, 5.0, 10.0]                      # initial beta std [deg]


def restart_P0(sd_deg):
    return np.diag([(sd_deg * DEG) ** 2, (2.0 * DEG) ** 2])


def experiment_restart(runs):
    out = []
    for case in RESTARTS:
        man = MANOEUVRE[case['key']]
        truth = truth_for(man)
        k0 = int(round(case['start'] / DT))
        first = np.zeros_like(truth['t'], bool)
        first[k0:k0 + int(round(1.0 / DT))] = True
        rows = []
        for sd0 in RESTART_P0:
            acc = {n: {'rmse': [], 'first': [], 'cover': []} for n in ('EKF', 'UKF')}
            for seed in range(runs):
                meas = measure(truth, np.random.default_rng(2000 + seed))
                for cls in (EKF, UKF):
                    beta, sd, _ = run_filter(cls, meas, k0=k0, P0=restart_P0(sd0))
                    e = errors(beta, sd, truth)
                    a = acc[cls.name]
                    a['rmse'].append(e['rmse'])
                    a['cover'].append(e['cover'])
                    a['first'].append(errors(beta, sd, truth, first)['rmse'])
            rows.append(dict(sd0=sd0, **{n: {k: mean_std(v) for k, v in a.items()} for n, a in acc.items()}))
        out.append(dict(key=case['key'], start=case['start'],
                        beta_at_start=round(float(truth['beta'][k0] / DEG), 2),
                        ay_at_start=round(float(truth['ay'][k0]), 2), rows=rows))
    return out


# --------------------------------------------------------------------------
# Experiment 3: how much process noise Q do the filters tolerate at the limit
# --------------------------------------------------------------------------
Q_SWEEP = [0.02, 0.05, 0.1, 0.2, 0.4]                   # sqrt(Q_beta) [deg]


def experiment_q_sweep(runs, key='ramp'):
    truth = truth_for(MANOEUVRE[key])
    rows = []
    for q in Q_SWEEP:
        Qs = np.diag([(q * DEG) ** 2, Q[1, 1]])
        acc = {n: {'rmse': [], 'cover': []} for n in ('EKF', 'UKF')}
        for seed in range(runs):
            meas = measure(truth, np.random.default_rng(3000 + seed))
            for cls in (EKF, UKF):
                beta, sd, _ = run_filter(cls, meas, Q=Qs)
                e = errors(beta, sd, truth)
                acc[cls.name]['rmse'].append(e['rmse'])
                acc[cls.name]['cover'].append(e['cover'])
        rows.append(dict(q=q, **{n: {k: mean_std(v) for k, v in a.items()} for n, a in acc.items()}))
    return dict(key=key, rows=rows)


# --------------------------------------------------------------------------
# Reporting
# --------------------------------------------------------------------------
def fmt(ms, scale=1.0, digits=3):
    return '-' if ms is None else f'{ms[0] * scale:.{digits}f}'


def print_report(nominal, restart, sweep, runs):
    print(f'\n[1] Nominal: {runs} noise/bias realisations per manoeuvre, beta errors in deg')
    print(f"{'manoeuvre':<16}{'|b|max':>7}{'ay max':>7} | {'RMSE EKF':>9}{'UKF':>7} | "
          f"{'|ay|>6 EKF':>10}{'UKF':>7} | {'max EKF':>8}{'UKF':>6} | {'2sd EKF':>8}{'UKF':>6} | {'us EKF':>7}{'UKF':>6}")
    for man in MANEUVERS:
        r = nominal[man['key']]
        e, u = r['EKF'], r['UKF']
        print(f"{man['name']:<16}{r['peak']['beta']:>7.2f}{r['peak']['ay']:>7.2f} | "
              f"{fmt(e['rmse']):>9}{fmt(u['rmse']):>7} | {fmt(e['limit']):>10}{fmt(u['limit']):>7} | "
              f"{fmt(e['max'], digits=2):>8}{fmt(u['max'], digits=2):>6} | "
              f"{fmt(e['cover'], 100, 0):>7}%{fmt(u['cover'], 100, 0):>5}% | "
              f"{fmt(e['us'], digits=0):>7}{fmt(u['us'], digits=0):>6}")
    print('\n[2] Restart at the limit with beta_hat = 0 (RMSE whole run / first second, 2sd coverage)')
    for case in restart:
        print(f"  {case['key']} from t = {case['start']} s (beta = {case['beta_at_start']} deg, "
              f"a_y = {case['ay_at_start']} m/s^2)")
        for row in case['rows']:
            e, u = row['EKF'], row['UKF']
            print(f"    P0 sd {row['sd0']:>4.1f} deg | EKF {fmt(e['rmse'])} / {fmt(e['first'])} "
                  f"{fmt(e['cover'], 100, 0):>4}% | UKF {fmt(u['rmse'])} / {fmt(u['first'])} {fmt(u['cover'], 100, 0):>4}%")
    print(f"\n[3] Q sweep on the {sweep['key']} manoeuvre (RMSE deg, 2sd coverage)")
    for row in sweep['rows']:
        e, u = row['EKF'], row['UKF']
        print(f"    sqrt(Q_beta) {row['q']:>5.2f} deg | EKF {fmt(e['rmse'])} {fmt(e['cover'], 100, 0):>4}% | "
              f"UKF {fmt(u['rmse'])} {fmt(u['cover'], 100, 0):>4}%")


def traces(runs, nominal, restart, sweep):
    """Down-sampled time series (one noise realisation) for the blog figures."""
    stride = int(round(0.04 / DT))

    def ds(a, scale=1.0, digits=3):
        return [None if np.isnan(v) else round(float(v) * scale, digits) for v in a[::stride]]

    data = {'runs': runs, 'dt': 0.04, 'maneuvers': [], 'restart': [], 'sweep': sweep}
    for man in MANEUVERS:
        truth = truth_for(man)
        meas = measure(truth, np.random.default_rng(7))
        series = dict(key=man['key'], name=man['name'], note=man['note'], vx=man['vx'], mu=man['mu'],
                      t=ds(truth['t'], digits=2), swa=ds(truth['swa'], 1 / DEG, 1),
                      ay=ds(truth['ay'], digits=2), beta=ds(truth['beta'], 1 / DEG),
                      kin=ds(run_kinematic(meas), 1 / DEG),
                      X=ds(truth['X'], digits=2), Y=ds(truth['Y'], digits=2),
                      psi=ds(truth['psi'], 1 / DEG, 2), summary=nominal[man['key']])
        for cls in (EKF, UKF):
            beta, sd, _ = run_filter(cls, meas)
            series[cls.name.lower()] = ds(beta, 1 / DEG)
            series[cls.name.lower() + '_sd'] = ds(sd, 1 / DEG)
        data['maneuvers'].append(series)
    for case in restart:
        man = MANOEUVRE[case['key']]
        truth = truth_for(man)
        meas = measure(truth, np.random.default_rng(7))
        k0 = int(round(case['start'] / DT))
        entry = dict(case, t=ds(truth['t'], digits=2), beta=ds(truth['beta'], 1 / DEG), runs={})
        for sd0 in (5.0, 10.0):
            for cls in (EKF, UKF):
                beta, sd, _ = run_filter(cls, meas, k0=k0, P0=restart_P0(sd0))
                entry['runs'][f'{cls.name.lower()}_{sd0:g}'] = dict(beta=ds(beta, 1 / DEG), sd=ds(sd, 1 / DEG))
        data['restart'].append(entry)
    return data


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    parser.add_argument('--runs', type=int, default=30, help='noise realisations per case')
    parser.add_argument('--export', metavar='JSON', help='also write the figure data')
    args = parser.parse_args()
    nominal = experiment_nominal(args.runs)
    restart = experiment_restart(args.runs)
    sweep = experiment_q_sweep(args.runs)
    print_report(nominal, restart, sweep, args.runs)
    if args.export:
        with open(args.export, 'w') as fh:
            json.dump(traces(args.runs, nominal, restart, sweep), fh, separators=(',', ':'))
        print(f'\nwrote {args.export}')
