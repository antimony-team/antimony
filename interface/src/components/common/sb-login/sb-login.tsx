import React, {FormEvent, useEffect, useState} from 'react';

import {loadLinksPreset} from '@tsparticles/preset-links';
import Particles, {initParticlesEngine} from '@tsparticles/react';
import {observer} from 'mobx-react-lite';

import {Button} from 'primereact/button';
import {Image} from 'primereact/image';
import {Message} from 'primereact/message';

import SBInput from '@sb/components/common/sb-input/sb-input';
import {ParticlesOptions} from '@sb/components/common/sb-login/particles.conf';
import SBOverlay from '@sb/components/common/sb-overlay/sb-overlay';
import {useDataBinder} from '@sb/lib/stores/root-store';
import {If} from '@sb/types/control';

import './sb-login.sass';

interface SBLoginProps {
  visible: boolean;
}

/*
 * Unfortunately, we need to separate the login form from the particles to
 * prevent restarting the simulation every time.
 * https://github.com/Wufe/react-particles-js/issues/43
 */
const SBLogin = (props: SBLoginProps) => {
  const [particlesReady, setParticlesReady] = useState(false);

  useEffect(() => {
    void initParticlesEngine(async engine => {
      await loadLinksPreset(engine);
    }).then(() => setParticlesReady(true));
  }, []);

  return (
    <SBOverlay visible={props.visible} fullscreen={true}>
      <If condition={particlesReady}>
        <Particles options={ParticlesOptions} />
      </If>
      <LoginForm />
    </SBOverlay>
  );
};

const LoginForm = observer(() => {
  const dataBinder = useDataBinder();

  const [loginError, setLoginError] = useState<string | null>(null);

  function onFormSubmit(event: FormEvent) {
    event.preventDefault();
    const target = event.target as typeof event.target & {
      username: {value: string};
      password: {value: string};
    };

    void dataBinder
      .loginNative({
        username: target.username.value,
        password: target.password.value,
      })
      .then(response => {
        if (!response) {
          setLoginError('Invalid username or password');
        }
      });
  }

  function onUsernameChange() {
    setLoginError(null);
  }

  function onPasswordChange() {
    setLoginError(null);
  }

  return (
    <form onSubmit={onFormSubmit} className="sb-login-content">
      <div className="sb-login-header">
        <Image src="./antimony-logo.svg" width="55px" alt="" />
        <div className="sb-login-header-title" role="heading" aria-level={1}>
          Antimony
        </div>
        <div className="sb-login-header-subtitle">Sign in to continue</div>
      </div>
      <If condition={loginError}>
        <Message severity="error" text={loginError} />
      </If>

      <If condition={dataBinder.isAdminAuthEnabled}>
        <SBInput
          label="Username"
          id="username"
          autoComplete="username"
          invalid={loginError !== null}
          onValueSubmit={onUsernameChange}
          placeholder="Username"
        />
        <SBInput
          label="Password"
          id="password"
          type="password"
          autoComplete="current-password"
          invalid={loginError !== null}
          onValueSubmit={onPasswordChange}
          placeholder="Password"
        />
        <Button
          className="sb-button-accent sb-login-button"
          label="Sign in"
          type="submit"
        />
      </If>

      <If condition={dataBinder.isOpenIdAuthEnabled}>
        <If condition={dataBinder.isAdminAuthEnabled}>
          <div className="sb-login-divider">or</div>
        </If>
        <Button
          outlined
          label="Continue with OpenID Connect"
          icon="pi pi-external-link"
          type="button"
          onClick={() => dataBinder.loginWithOpenId()}
        />
      </If>
    </form>
  );
});

export default SBLogin;
