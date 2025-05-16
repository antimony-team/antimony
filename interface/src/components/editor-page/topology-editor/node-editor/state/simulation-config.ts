import {createContext, useContext} from 'react';

import {action, autorun, computed, observable} from 'mobx';

export class SimulationConfig {
  @observable accessor liveSimulation: boolean = false;
  @observable accessor nodeRepulsion: number;
  @observable accessor idealEdgeLength: number;
  @observable accessor edgeElasticity: number;

  @observable accessor panelOpen: boolean;
  @observable accessor isStabilizing: boolean = false;

  public static readonly DefaultPhysics = {
    name: 'cose-bilkent',
    animate: true,
    animationDuration: 800,
    idealEdgeLength: 100,
    edgeElasticity: 0.08,
    nodeRepulsion: 5000,
    gravity: 0.01,
    fit: true,
    padding: 30,
    randomize: true,
  };

  constructor() {
    this.panelOpen = this.readBool('simPanelOpen') ?? false;
    this.nodeRepulsion =
      this.readFloat('simNodeRepulsion') ??
      SimulationConfig.DefaultPhysics.nodeRepulsion;
    this.idealEdgeLength =
      this.readInt('simIdealEdgeLength') ??
      SimulationConfig.DefaultPhysics.idealEdgeLength;
    this.edgeElasticity =
      this.readFloat('simEdgeElasticity') ??
      SimulationConfig.DefaultPhysics.edgeElasticity;

    autorun(() => this.writeBool('simPanelOpen', this.panelOpen));
    autorun(() => this.writeFloat('simNodeRepulsion', this.nodeRepulsion));
    autorun(() => this.writeInt('simIdealEdgeLength', this.idealEdgeLength));
    autorun(() => this.writeFloat('simEdgeElasticity', this.edgeElasticity));

    this.setNodeRepulsion = this.setNodeRepulsion.bind(this);
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
      idealEdgeLength: this.idealEdgeLength,
      edgeElasticity: this.edgeElasticity,
      nodeRepulsion: this.nodeRepulsion,
      gravity: 0.01,
      fit: true,
      padding: 30,
      randomize: true,
    };
  }

  @action
  public setNodeRepulsion(nodeRepulsion: number) {
    this.nodeRepulsion = nodeRepulsion;
  }

  @action
  public setSpringLength(idealEdgeLength: number) {
    this.idealEdgeLength = idealEdgeLength;
  }

  @action
  public setSpringConstant(springConstant: number) {
    this.edgeElasticity = springConstant;
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
