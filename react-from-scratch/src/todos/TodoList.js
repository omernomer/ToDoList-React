import React,{useEffect} from 'react';
import TodoListItem from './TodoListItem';
import {connect} from 'react-redux';
import {completeTodo} from './actions';
import NewTodoForm from './NewTodoForm';
import {completeTodoRequest, displayAlert,loadTodos,removeTodoRequest} from './thunks';
import { isLoading } from './reducers';
import {
    getTodosLoading,
    getIncompleteTodos,
    getCompleteTodos
} from './selectors';
import styled from 'styled-components';

const TodoList = ({completedTodos,inCompletedTodos,onRemovePressed,onCompletedPressed,isLoading,startLoadingTodos}) => {
    useEffect(()=>{
        startLoadingTodos();
    },[])
    const loadingMessage=<div>Loading Content...</div>;
    const content= (
        <div className="list-wrapper">
            <NewTodoForm/>
            <div className="row mt-3">
                <div className="col-12">
                    <h4>InCompleted:</h4>
                </div>
            </div>    
            {inCompletedTodos.map(todo=><TodoListItem key={todo.id} todo={todo} onRemovePressed={onRemovePressed} onCompletedPressed={onCompletedPressed}/>)}
            <div className="row mt-3">
                <div className="col-12">
                    <h4>Completed:</h4>
                </div>
            </div>
            {completedTodos.map(todo=><TodoListItem key={todo.id} todo={todo} onRemovePressed={onRemovePressed} onCompletedPressed={onCompletedPressed}/>)}
        </div>
    );
    return isLoading?loadingMessage:content;
}

const mapStateToProps=state=>({
    isLoading:getTodosLoading(state),
    completedTodos:getCompleteTodos(state),
    inCompletedTodos:getIncompleteTodos(state),
});
const mapDispatchToProps=dispatch=>({
    startLoadingTodos: ()=>dispatch(loadTodos()),
    onRemovePressed: id => dispatch(removeTodoRequest(id)),
    onCompletedPressed: id => dispatch(completeTodoRequest(id)),
});
export default connect(mapStateToProps,mapDispatchToProps)(TodoList);