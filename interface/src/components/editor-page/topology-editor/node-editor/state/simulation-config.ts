import {createContext, useContext} from 'react';

import {action, autorun, computed, observable} from 'mobx';

export class SimulationConfig {
  @observable accessor liveSimulation: boolean = false;
  @observable accessor centralGravity: number;
  @observable accessor springLength: number;
  @observable accessor springConstant: number;

  @observable accessor panelOpen: boolean;
  @observable accessor isStabilizing: boolean = false;

  public static readonly DefaultPhysics = {
    name: 'cose-bilkent',
    animate: true,
    animationDuration: 800,
    idealEdgeLength: 100,
    edgeElasticity: 0.08,
    gravity: 0.01,
    fit: true,
    padding: 30,
    randomize: true,
  };

  constructor() {
    this.panelOpen = this.readBool('simPanelOpen') ?? false;
    this.centralGravity =
      this.readFloat('simCentralGravity') ??
      SimulationConfig.DefaultPhysics.gravity;
    this.springLength =
      this.readInt('simSpringLength') ??
      SimulationConfig.DefaultPhysics.idealEdgeLength;
    this.springConstant =
      this.readFloat('simSpringConstant') ?? SimulationConfig.DefaultPhysics.edgeElasticity;

    autorun(() => this.writeBool('simPanelOpen', this.panelOpen));
    autorun(() => this.writeFloat('simCentralGravity', this.centralGravity));
    autorun(() => this.writeInt('simSpringLength', this.springLength));
    autorun(() => this.writeFloat('simSpringConstant', this.springConstant));

    this.setLiveSimulation = this.setLiveSimulation.bind(this);
    this.setCentralGravity = this.setCentralGravity.bind(this);
    this.setSpringLength = this.setSpringLength.bind(this);
    this.setSpringConstant = this.setSpringConstant.bind(this);
    this.setIsStabilizing = this.setIsStabilizing.bind(this);
    this.togglePanel = this.togglePanel.bind(this);
  }

  private writeBool(key: string, value: boolean) {
    sessionStorage.setItem(key, JSON.stringify(value));
  }

  private writeInt(key: string, value: number) {
    sessionStorage.setItem(key, JSON.stringify(value));
  }

  private writeFloat(key: string, value: number) {
    sessionStorage.setItem(key, JSON.stringify(value));
  }

  private readBool(key: string): boolean | null {
    const item = sessionStorage.getItem(key);
    return item ? JSON.parse(item) : null;
  }

  private readInt(key: string): number | null {
    const item = sessionStorage.getItem(key);
    return item ? parseInt(item, 10) : null;
  }

  private readFloat(key: string): number | null {
    const item = sessionStorage.getItem(key);
    return item ? parseFloat(item) : null;
  }

  @computed
  public get config() {
    return {
      name: 'cose-bilkent',
      animate: true,
      animationDuration: 800,
      idealEdgeLength: this.springLength,
      edgeElasticity: this.springConstant,
      gravity: this.centralGravity,
      fit: true,
      padding: 30,
      randomize: true,
    };
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
