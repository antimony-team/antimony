import React, {ChangeEvent, FormEvent, useEffect, useState} from 'react';

import classNames from 'classnames';
import {observer} from 'mobx-react-lite';
import {Button} from 'primereact/button';
import {Message} from 'primereact/message';
import {Password} from 'primereact/password';
import {Checkbox} from 'primereact/checkbox';
import {InputText} from 'primereact/inputtext';
import {loadLinksPreset} from '@tsparticles/preset-links';
import Particles, {initParticlesEngine} from '@tsparticles/react';

import {If} from '@sb/types/control';
import {useDataBinder} from '@sb/lib/stores/root-store';
import {ParticlesOptions} from '@sb/components/common/sb-login/particles.conf';

import './sb-login.sass';

const SBLogin = observer(() => {
  const [particlesReady, setParticlesReady] = useState(false);

  const dataBinder = useDataBinder();

  useEffect(() => {
    void initParticlesEngine(async engine => {
      await loadLinksPreset(engine);
    }).then(() => setParticlesReady(true));
  }, []);

  const LoginForm = () => {
    const [loginError, setLoginError] = useState<string | null>(null);
    const [checkedRemember, setCheckedRemember] = useState(false);

    const [usernameValue, setUsernameValue] = useState<string>('');
    const [passwordValue, setPasswordValue] = useState<string>('');

    function onFormSubmit(event: FormEvent) {
      event.preventDefault();
      const target = event.target as typeof event.target & {
        username: {value: string};
        password: {value: string};
      };

      dataBinder
        .login(
          {
            username: target.username.value,
            password: target.password.value,
          },
          checkedRemember
        )
        .then(response => {
          if (!response) {
            setLoginError('Invalid username or password');
          }
        });
    }

    function onUsernameChange(event: ChangeEvent<HTMLInputElement>) {
      setLoginError(null);
      setUsernameValue(event.target.value);
    }

    function onPasswordChange(event: ChangeEvent<HTMLInputElement>) {
      setLoginError(null);
      setPasswordValue(event.target.value);
    }

    return (
      <form onSubmit={onFormSubmit} className="sb-login-content">
        <div className="sb-login-content-icon">
          <div className="sb-login-header-icon">
            <i className="pi pi-user"></i>
          </div>
        </div>
        <If condition={loginError}>
          <Message severity="error" text={loginError} />
        </If>
        <div className="p-inputgroup">
          <span className="p-inputgroup-addon">
            <i className="pi pi-user"></i>
          </span>
          <InputText
            autoComplete="username"
            invalid={loginError !== null}
            value={usernameValue}
            onChange={onUsernameChange}
            name="username"
            placeholder="Username"
          />
        </div>
        <div className="p-inputgroup">
          <span className="p-inputgroup-addon">
            <i className="pi pi-lock"></i>
          </span>
          <Password
            autoComplete="current-password"
            invalid={loginError !== null}
            value={passwordValue}
            onChange={onPasswordChange}
            feedback={false}
            name="password"
            placeholder="Password"
          />
        </div>
        <div className="sb-login-remember">
          <div className="flex align-items-center">
            <Checkbox
              inputId="login-remember-me"
              checked={checkedRemember}
              onChange={e => setCheckedRemember(e.checked ?? false)}
            />
            <label htmlFor="login-remember-me" className="ml-2">
              Remember me
            </label>
          </div>
        </div>

        <Button label="LOGIN" type="submit" aria-label="Login" />

        <div className="sb-login-content-header">
          <span>SIGN IN</span>
        </div>
      </form>
    );
  };

  /*
   * Unfortunately we need to separate the login form from the particles to
   * prevent restarting the simulation every time.
   * https://github.com/Wufe/react-particles-js/issues/43
   */
  return (
    <If condition={particlesReady}>
      <div
        className={classNames('sb-login-container', 'sb-animated-overlay', {
          visible: !dataBinder.isLoggedIn && !dataBinder.hasConnectionError,
        })}
      >
        <If condition={!dataBinder.isLoggedIn}>
          <Particles options={ParticlesOptions} />
        </If>
        <LoginForm />
      </div>
    </If>
  );
});

export default SBLogin;
