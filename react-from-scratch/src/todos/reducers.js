import {
    COMPLETE_TODO, CREATE_TODO,REMOVE_TODO,
    LOAD_TODOS_FAILURE,
    LOAD_TODOS_SUCCESS,
    LOAD_TODOS_IN_PROGRESS,
    loadTodosFailure,
    loadTodosInProgress} from './actions';

const initialState = {isLoading:false, data:[]};

export const todos =(state=initialState,action)=>{
    const {type,payload}=action;
    switch(type){
        case CREATE_TODO: {
            const {todo}=payload;
            return {
                ...state,
                data:state.data.concat(todo)
            }
        }
        case REMOVE_TODO: {
            const {todo:todoToRemove}=payload;
            return {
                ...state,
                data: state.data.filter(todo => todo.id !== todoToRemove.id),
            }
        }
        case COMPLETE_TODO:{
            const {todo:todoToComplete}=payload;
            return {
                ...state,
                data: state.data.map(todo=> {
                if(todo.id===todoToComplete.id) {
                    return {...todo,isCompleted:true};
                }
                else {
                    return todo;
                }
                })
            }
        }
        case LOAD_TODOS_SUCCESS:{
            const {todos}=payload;
            return {
                ...state,
                isLoading:false,
                data:todos,
            }
        }
        case loadTodosInProgress:{
            return {
                ...state,
                isLoading:true,
            }
        }
        case loadTodosFailure:{
            return {
                ...state,
                isLoading:false,
            }
        }
        default:
            return state;
    }
}