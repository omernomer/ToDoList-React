import React from 'react';
import {hot} from 'react-hot-loader';
import './App.css';
import TodoList from './todos/TodoList';

const App = () => {
    return (
        <div className="container">
        <div className="App">
            <TodoList/>
        </div>
        </div>
    );
}
 
export default hot(module)(App);