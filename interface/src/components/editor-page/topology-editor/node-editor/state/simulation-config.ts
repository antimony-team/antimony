import {createContext, useContext} from 'react';

import Cookies from 'js-cookie';
import {action, autorun, computed, observable} from 'mobx';

import {NetworkOptions} from '../network.conf';
import * as CookieParser from '@sb/lib/utils/local-config';

export class SimulationConfig {
  @observable accessor liveSimulation: boolean = false;
  @observable accessor centralGravity: number;
  @observable accessor springLength: number;
  @observable accessor springConstant: number;

  @observable accessor panelOpen: boolean;
  @observable accessor isStabilizing: boolean = false;

  public static readonly DefaultCentralGravity =
    NetworkOptions.physics.forceAtlas2Based.centralGravity;
  public static readonly DefaultSpringLength =
    NetworkOptions.physics.forceAtlas2Based.springLength;
  public static readonly DefaultSpringConstant =
    NetworkOptions.physics.forceAtlas2Based.springConstant;

  constructor() {
    this.panelOpen = CookieParser.readBool('simPanelOpen') ?? false;
    this.centralGravity =
      CookieParser.readFloat('simCentralGravity') ??
      SimulationConfig.DefaultCentralGravity;
    this.springLength =
      CookieParser.readInt('simSpringLength') ??
      SimulationConfig.DefaultSpringLength;
    this.springConstant =
      CookieParser.readFloat('simSpringConstant') ??
      SimulationConfig.DefaultSpringConstant;

    autorun(() => Cookies.set('simPanelOpen', String(this.panelOpen)));
    autorun(() =>
      Cookies.set('simCentralGravity', String(this.centralGravity))
    );
    autorun(() => Cookies.set('simSpringLength', String(this.springLength)));
    autorun(() =>
      Cookies.set('simSpringConstant', String(this.springConstant))
    );

    this.setLiveSimulation = this.setLiveSimulation.bind(this);
    this.setCentralGravity = this.setCentralGravity.bind(this);
    this.setSpringLength = this.setSpringLength.bind(this);
    this.setSpringConstant = this.setSpringConstant.bind(this);
    this.setIsStabilizing = this.setIsStabilizing.bind(this);
    this.togglePanel = this.togglePanel.bind(this);
  }

  @computed
  public get config() {
    const physics = {
      physics: {
        ...NetworkOptions.physics,
        forceAtlas2Based: {
          ...NetworkOptions.physics.forceAtlas2Based,
          centralGravity: this.centralGravity,
          springLength: this.springLength,
          springConstant: this.springConstant,
        },
      },
    };
    return physics;
  }

  @action
  public setLiveSimulation(liveSimulation: boolean) {
    this.liveSimulation = liveSimulation;
  }

  @action
  public setCentralGravity(centralGravity: number) {
    this.centralGravity = centralGravity;
  }

  @action
  public setSpringLength(springLength: number) {
    this.springLength = springLength;
  }

  @action
  public setSpringConstant(springConstant: number) {
    this.springConstant = springConstant;
  }

  @action
  public setIsStabilizing(isStabilizing: boolean) {
    this.isStabilizing = isStabilizing;
  }

  @action
  public togglePanel() {
    if (this.panelOpen) {
      this.liveSimulation = false;
    }
    this.panelOpen = !this.panelOpen;
  }
}

export const SimulationConfigContext = createContext({} as SimulationConfig);

export const useSimulationConfig = () => {
  return useContext(SimulationConfigContext);
};
