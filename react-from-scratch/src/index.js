import React from 'react';
import ReactDOM from 'react-dom';
import App from './App.js';
import {Provider} from 'react-redux';
import {configureStore} from './store';
import {persistStore} from 'redux-persist';
import {PersistGate} from 'redux-persist/lib/integration/react';
import 'bootstrap/dist/css/bootstrap.min.css';
import $ from 'jquery';
import Popper from 'popper.js';
import 'bootstrap/dist/js/bootstrap.bundle.min';

const store=configureStore();
const persistor = persistStore(store);

ReactDOM.render(
    <Provider store={store}>
        <PersistGate persistor={persistor} loading={<div>Loading...</div>}>
            <App/>
        </PersistGate>
    </Provider>,document.getElementById('root'));