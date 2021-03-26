import React from 'react';

const TodoListItem = ({todo,onRemovePressed,onCompletedPressed}) => {
    return (
        <div className="border m-1 rounded bg-white">
            <div className="text-lg m-2">{todo.text}</div>
            <div className="buttons-container clearfix border-top p-1">
                {todo.isCompleted?null:<button className="completed-btn btn btn-success btn-sm"
                onClick={()=>onCompletedPressed(todo.id)}
                >Completed</button>}
                <button className="remove-btn btn btn-danger btn-sm float-right"
                onClick={()=>onRemovePressed(todo.id)}
                >Remove</button>
            </div>
        </div>
    );
}
 
export default TodoListItem;