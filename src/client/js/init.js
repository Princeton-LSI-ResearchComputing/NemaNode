// babel and fetch polyfill to ensure browsers have all functionality to support babel
require('@babel/polyfill');
require('whatwg-fetch');
require('./register-cytoscape-extensions')();
require('./google-analytics')();

const $ = require('jquery');
const cytoscape = require('cytoscape');
cytoscape.warnings(false);

const liveReloadSync = require('./live-reload-sync');

const Model = require('./model');
const Controller = require('./controller');
const View = require('./view');

const services = require('./services');
const DataService = require('./data-service');

const DEBUG = process.env.NODE_ENV !== 'production';

$(document).ready(() => {
  $('#noscript').hide();

  Promise.all([services.getNematodeCells(), services.getNematodeDatasets()])
    .then(data => {
      let [cells, datasets] = data;
      DataService.load(cells, datasets);

      let model = new Model();
      let view = new View(model);
      let controller = new Controller(model, view);

      if (DEBUG) {
        window.m = model;
        window.v = view;
        window.c = controller;
        window.ds = DataService;
        liveReloadSync();
        cytoscape.warnings(true);
        console.log('Running in debug mode');
      }

      // Mobile-specific initialization.
      let onSelectionChanged = () => {
        if (view.graph.getSelected().length > 0) {
          view.popup.show();
          view.popup.update();
        } else {
          view.popup.hide();
        }
      };
      let onBackgroundClick = () => {
        view.popup.hide();
        view.legend.close();
        if (!model.showEdgeLabel) {
          view.graph.toggleEdgeLabel('all', false);
        }
      };
      let onOptionSelected = () => {
        view.popup.close();
      };
      let onEdgeClick = e => {
        e.target.toggleClass('showEdgeLabel');
        e.target.toggleClass('focus');
      };

      let isSmallScreen = false;
      $(window).on('resize', () => {
        if (window.innerWidth <= 640) {
          if (isSmallScreen) {
            return;
          }
          isSmallScreen = true;
          view.graph.disableAnimations();
          view.graph.on('selectionChanged layoutstop', onSelectionChanged);
          view.graph.on('backgroundClick', onBackgroundClick);
          view.popup.on('optionSelected', onOptionSelected);
          view.popup.isMobile = true;
          view.graph.cy.on('tap', 'edge', onEdgeClick);
        } else {
          if (!isSmallScreen) {
            return;
          }
          isSmallScreen = false;
          view.graph.enableAnimations();
          view.graph.off('selectionChanged layoutstop', onSelectionChanged);
          view.graph.off('backgroundClick', onBackgroundClick);
          view.popup.off('optionSelected', onOptionSelected);
          view.popup.isMobile = false;
          view.graph.cy.off('tap', 'edge', onEdgeClick);
        }
      });
      $(window).trigger('resize');

      // URLs containing more than 2048 characters are cropped on IE.
      let ua = window.navigator.userAgent;
      let isIE =
        ua.indexOf('MSIE ') > 0 ||
        ua.indexOf('Trident/') > 0 ||
        ua.indexOf('Edge/') > -1;
      if (isIE && location.href.length >= 2048) {
        alert(
          'The network may not load properly because of a limitation with ' +
            'your browser. Please try with another browser such as Google Chrome.'
        );
      }

      // Load saved state. Cookies are overwritten by URL.
      let cookieParameters = view.cookies.getCookieParameters();
      let urlParameters = view.cookies.getURLParameters();
      controller.setState(Object.assign(cookieParameters, urlParameters), true);

      // Set cursor in the searchbar.
      view.searchbar.focus();
    })
    .catch(e => {
      let errorMsg =
        'Cannot load data file!\nPlease contact us if the problem persists!';
      alert(errorMsg);
      throw e;
    });
});
