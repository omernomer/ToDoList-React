import React,{useState} from 'react';
import {connect} from 'react-redux';
import {addTodoRequest} from './thunks';
import {getTodos} from './selectors';

const NewTodoForm = ({todos,onCreatePressed}) => {
    const [inputValue,setInputValue]=useState('');
    return (
        <div className="new-todo-form row">

            <input className="new-todo-input col-10 form-control" type="text" 
            value={inputValue}
            onChange={e=>setInputValue(e.target.value)}
            placeholder="New Todo"
            />
            <button className="new-todo-btn col-2 btn btn-info form-control"
            onClick={()=>{
                const isDuplicateText=todos.some(todo=>todo.text===inputValue);
                if(!isDuplicateText && inputValue!=="") {
                    onCreatePressed(inputValue);
                    setInputValue('');
                }
                else {
                    alert("Error: Either empty text or duplicate text.");
                    setInputValue('');
                }
            }}
            >Create</button>
        </div>
    );
}
 
const mapStateToProps = state =>({
    todos:getTodos(state),
});
const mapDispatchToProps = dispatch =>({
    onCreatePressed: text => dispatch(addTodoRequest(text))
});

export default connect(mapStateToProps,mapDispatchToProps)(NewTodoForm);