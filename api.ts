import { Todo } from "./model.js";

async function fetchTodos(): Promise<Todo[]> {
  try {
    const response = await fetch('https://jsonplaceholder.typicode.com/todos'); // Replace with your actual API endpoint
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data: Todo[] = await response.json();
    return data;
  } catch (error) {
    console.error("Error fetching todos:", error);
    return []; // Return an empty array or handle the error as appropriate
  }
}

export { fetchTodos };