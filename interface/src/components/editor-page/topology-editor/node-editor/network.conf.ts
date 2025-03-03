export const NetworkOptions = {
  layout: {
    hierarchical: false,
    randomSeed: 69,
  },
  interaction: {
    hover: true,
  },
  nodes: {
    shape: 'image',
    color: '#42b5ac',
    font: {
      face: 'Figtree',
      color: '#42b5ac',
    },
    size: 30,
  },
  edges: {
    color: '#42b5ac',
    chosen: false,
    arrows: {
      from: {
        enabled: false,
      },
      middle: {
        enabled: false,
      },
      to: {
        enabled: false,
      },
    },
    width: 2,
    smooth: {
      enabled: true,
      type: 'dynamic',
      roundness: 0,
    },
  },
  physics: {
    enabled: true,
    solver: 'forceAtlas2Based',
    forceAtlas2Based: {
      theta: 0.7,
      damping: 0.4,
      centralGravity: 0.01,
      springConstant: 0.08,
      springLength: 100,
    },
    stabilization: {
      enabled: true,
      iterations: 1200,
      updateInterval: 30,
      fit: true,
    },
    maxVelocity: 40,
    minVelocity: 0.5,
  },
};
