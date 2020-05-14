const DataService = require('../data-service');

const {
  union,
  deepCopy,
  unique,
  sum,
  difference,
  flatten,
  max,
  min,
  intersection
} = require('../util');

const { createGrid } = require('./layout');
const Graph = require('./graph');

let ModelPrototype = {};

// convert a model node into a cytoscape compatible format
// modelState is from the ./Model.js
ModelPrototype.makeCytoscapeNode = function(nodeId, modelState) {
  let { nodeColor, input, groups, showLinked, hidden, selected } = modelState;

  const typeKeys = {
    b: 'muscle',
    u: 'others',
    s: 'sensory',
    i: 'inter',
    m: 'motor',
    n: 'neurosecretory'
  };

  let name;
  let nts;
  let types;
  let classes = [];

  if (input.includes(nodeId)) {
    classes.push('searchedfor');
  }

  if (groups.hasOwnProperty(nodeId)) {
    let group = groups[nodeId];
    name = group.name;
    nts = flatten(
      group.members.map(member => DataService.nt(member).split(''))
    );
    types = flatten(
      group.members.map(member => DataService.typ(member).split(''))
    );
    classes.push('parentNode');
  } else {
    name = nodeId;
    nts = DataService.nt(nodeId).split('');
    types = DataService.typ(nodeId).split('');
  }

  if (!showLinked) {
    classes.push('nolinked');
  }

  if (hidden.includes(nodeId)) {
    classes.push('hidden');
  }

  let cytoscapeNode = {
    group: 'nodes',
    classes: classes.join(' '),
    data: {
      id: nodeId,
      name,
      color: nodeColor
    },
    selected: selected.includes(nodeId)
  };

  nts.forEach(nt => {
    if (!cytoscapeNode.data.hasOwnProperty(nt)) {
      cytoscapeNode.data[nt] = 0;
    }

    cytoscapeNode.data[nt] += 1 / nts.length;
  });

  types.forEach(type => {
    let longtype = typeKeys[type];

    if (!cytoscapeNode.data.hasOwnProperty(longtype)) {
      cytoscapeNode.data[longtype] = 0;
    }

    cytoscapeNode.data[longtype] += 1 / types.length;
  });

  for (let id in groups) {
    if (groups[id].members.includes(nodeId)) {
      cytoscapeNode.data.parent = id;
    }
  }
  return cytoscapeNode;
};

// convert a model edge into a cytoscape compatible format
// modelState is from the ./Model.js
ModelPrototype.makeCytoscapeEdge = function(
  sourceId,
  targetId,
  edgeType,
  attr,
  modelState
) {
  let { showEdgeLabel, showConnectionColor, datasets, database } = modelState;
  let { synapses, annotations } = attr;
  let classes = [];

  let syns = datasets.map(dataset => synapses[dataset] || 0);
  let meanSyn = sum(syns) / syns.length;
  let width;

  if (edgeType === 0) {
    width = Math.max(1, 3 * Math.pow(meanSyn, 1 / 3) - 2);
  } else {
    width = Math.min(8, meanSyn * 1.5);
  }

  let notImaged = annotations.includes('not-imaged');
  let label = datasets
    .map(dataset => {
      return notImaged && dataset === 'adult' ? '?' : synapses[dataset] || 0;
    })
    .join(',');

  let longLabel = datasets
    .map(dataset => {
      let datasetName = DataService.getDatasetInfo(database, dataset).name;
      let datasetLabel =
        notImaged && dataset == 'adult'
          ? 'Region not imaged'
          : synapses[dataset] || 0;
      return `${datasetName}: ${datasetLabel}`;
    })
    .join('\n');

  if (showEdgeLabel) {
    classes.push('showEdgeLabel');
  }

  // from most to least important
  // if an edge has multiple annotations, only the most important
  // annotation type will be shown color wise
  const ANNOTATION_ORDER = [
    'not-imaged',
    'increase',
    'decrease',
    'stable',
    'postembryonic',
    'variable'
  ];

  const ANNOTATION_DISPLAY_LABEL_MAP = {
    'not-imaged': 'not-imaged',
    'increase': 'mature',
    'decrease': 'juvenile',
    'stable': 'stable',
    'postembryonic': 'post-embryonic',
    'variable': 'variable'
  };

  // only add the first annotation type w.r.t annnotation order
  //that is found in this connections annotations
  if (showConnectionColor){
    for ( let annotationType of ANNOTATION_ORDER ){
      if (annotations.includes(annotationType)) {
        classes.push(ANNOTATION_DISPLAY_LABEL_MAP[annotationType]);
        break;
      }
    }
  }

  let cytoscapeEdge = {
    group: 'edges',
    classes: classes.join(' '),
    data: {
      id: `${sourceId}-${edgeType}-${targetId}`,
      source: sourceId,
      target: targetId,
      type: edgeType,
      width,
      label,
      label_long: longLabel
    }
  };

  return cytoscapeEdge;
};

ModelPrototype.convertModelToCytoscape = function(
  connections,
  updateType,
  modelState,
  runLayout
) {
  const PRE = 0;
  const GJ = 2;

  let {
    input: inputs,
    positions: savedPositions,
    showPostemb,
    showIndividual,
    split,
    hidden,
    joined,
    groups,
    layout,
    lockedPositions
  } = modelState;

  let populateNetwork = (nodes, connections) => {
    let g = new Graph();
    nodes.forEach(node => g.addNode(node));
    connections.forEach(connection => {
      let { pre, post, type, synapses, annotations } = connection;

      g.addEdge(pre.toUpperCase(), post.toUpperCase(), type, {
        synapses,
        annotations
      });
    });

    return g;
  };

  let filterNetwork = (network, inputNodeIds, showIndividual, showPostemb) => {
    // Remove cell classes if individual mode, and individual cells if not.
    // Split and joined cells are the exception.
    difference(network.nodes(), inputNodeIds).forEach(nodeId => {
      let isCell = DataService.isCell(nodeId);
      let isClass = DataService.isClass(nodeId);
      let cls = DataService.cellClass(nodeId);
      if (split.includes(cls)) {
        if (isCell) {
          return;
        }
        network.removeNode(nodeId);
      }
      if (joined.includes(cls)) {
        if (isClass) {
          return;
        }
        network.removeNode(nodeId);
      }
      if (showIndividual && !isCell) {
        network.removeNode(nodeId);
      }
      if (!showIndividual && !isClass) {
        network.removeNode(nodeId);
      }
    });

    // Remove post-embryonic nodes .
    if (!showPostemb) {
      network.nodes().forEach(nodeId => {
        if (!DataService.isEmb(nodeId)) {
          G.removeNode(nodeId);
        }
      });
    }

    difference(network.nodes(), inputNodeIds).forEach(nodeId => {
      // Remove orphan nodes. * This is a misnomer
      //  (Note that this doesnt mean nodes without a parent)
      // orphan nodes in this context means nodes without any edges
      // TODO rename this
      if (network.isIsolated(nodeId)) {
        network.removeNode(nodeId);
      }
    });
  };

  let convertGroupsToCytoscape = (network, groups) => {
    Object.entries(groups).forEach(([groupId, group]) => {
      let { members: groupMembers, open: groupOpen } = group;

      if (intersection(groupMembers, network.nodes()).length > 0) {
        network.addNode(groupId);

        if (!groupOpen) {
          let groupEdges = {
            chemical: flatten(groupMembers.map(gm => G.edges('chemical', gm))), // for some reason we need this as a triple nested array
            electrical: flatten(
              groupMembers.map(gm => G.edges('electrical', gm))
            ) // for some reason we need this as a triple nested array
          };

          groupMembers.forEach(member => network.removeNode(member));

          Object.entries(groupEdges).forEach(([edgeType, edgesWithType]) => {
            edgesWithType.forEach(edge => {
              let [source, target, attributes] = edge;
              let {
                synapses: newSynapses,
                annotations: newAnnotations
              } = attributes;

              let newSource = group.members.includes(source) ? groupId : source;
              let newTarget = group.members.includes(target) ? groupId : target;

              if (network.hasEdge(newSource, newTarget, edgeType)) {
                let {
                  synapses: previousSynapses,
                  annotations: previousAnnotations
                } = network.getEdge(newSource, newTarget, edgeType);

                newAnnotations = union(newAnnotations, previousAnnotations);

                Object.keys(newSynapses).forEach(datasetId => {
                  newSynapses[datasetId] =
                    (newSynapses[datasetId] || 0) +
                    (previousSynapses[datasetId] || 0);
                });
              }

              network.addEdge(newSource, newTarget, edgeType, {
                synapses: newSynapses,
                annotations: newAnnotations
              });
            });
          });
        }
      }
    });
  };

  let removeHiddenNodes = (network, hidden, groupIds) => {
    hidden.forEach(nodeId => network.removeNode(nodeId));

    let hiddenGroupIds = groupIds.filter(groupId => hidden.includes(groupId));

    hiddenGroupIds.forEach(gId => {
      groups[gId].members.forEach(gm => network.removeNode(gm));
    });
  };

  let G = populateNetwork(inputs, connections);

  filterNetwork(G, inputs, showIndividual, showPostemb);

  convertGroupsToCytoscape(G, groups);

  removeHiddenNodes(G, hidden, Object.keys(groups));

  // Convert network to cytoscape readable format.
  let nodes = {};
  let hiddenNodes = {};
  let edges = {};

  G.nodes().forEach(n => {
    nodes[n] = this.makeCytoscapeNode(n, modelState);
  });

  hidden.forEach(n => {
    hiddenNodes[n] = this.makeCytoscapeNode(n, modelState);
  });

  G.edges('chemical').forEach(e => {
    let edge = this.makeCytoscapeEdge(e[0], e[1], PRE, e[2], modelState);
    edges[edge['data']['id']] = edge;
  });

  G.edges('electrical').forEach(e => {
    let edge = this.makeCytoscapeEdge(e[0], e[1], GJ, e[2], modelState);
    edges[edge['data']['id']] = edge;
  });

  // Add positions.
  // If positions are locked, new nodes will be placed in the grid layout next to the current
  // network. New nodes can also be added during minor updates if a class is joined.
  let positions = {};
  if (lockedPositions.length > 1 || updateType == 'minor') {
    let nodesWithoutPositions = [];

    G.nodes().forEach(n => {
      if (groups.hasOwnProperty(n) && groups[n].open) {
        return;
      }

      if (lockedPositions.length > 1) {
        if (lockedPositions.includes(n)) {
          positions[n] = deepCopy(savedPositions[n]);
        } else {
          nodesWithoutPositions.push(n);
          nodes[n]['classes'] += ' unpositioned';
        }
      }

      if (updateType == 'minor') {
        if (savedPositions.hasOwnProperty(n)) {
          positions[n] = deepCopy(savedPositions[n]);
        } else {
          nodesWithoutPositions.push(n);
          if (!nodes[n]['classes'].includes('unpositioned')) {
            nodes[n]['classes'] += ' unpositioned';
          }
        }
      }
    });

    nodesWithoutPositions = unique(nodesWithoutPositions);
    let xArr = difference(Object.keys(positions), nodesWithoutPositions).map(
      n => positions[n].x
    );
    let yArr = difference(Object.keys(positions), nodesWithoutPositions).map(
      n => positions[n].y
    );

    let limboPositions = createGrid(nodesWithoutPositions, {
      x: max(xArr) + 200,
      y: (max(yArr) + min(yArr)) / 2,
      rows: 4
    });
    positions = Object.assign(positions, limboPositions);
  }

  // Emit changes for view.
  return {
    nodes,
    edges,
    hidden: hiddenNodes,
    positions,
    hiddenPositions: createGrid(Object.keys(hiddenNodes), {
      x: 40,
      y: 40,
      rows: 4,
      spacing: 80
    }),
    layout,
    runLayout
  };
};

module.exports = ModelPrototype;
