import express, { Application, Request, Response } from 'express';
import session from 'express-session';
import path from 'path';
const __dirname = path.dirname('.'); // get the name of the directory

// Extend express-session types to include 'user'
declare module 'express-session' {
  interface SessionData {
    questions?: any[]; 
    answers?: any[];
  }
}

import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { StateGraph, END,  START} from "@langchain/langgraph";
import { MemorySaver, Annotation, MessagesAnnotation, messagesStateReducer } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import { ChatWatsonx } from "@langchain/community/chat_models/ibm";

import { fetchTodos } from "./api.js"
import { setEnvironment } from "./env.js"

setEnvironment();

const agentic_instructions = {
  credit_score_tool:'Get the credit score for the customer using the customer id. Customer\'s name can be used instead of customer\'s id. If the credit score is already known do not retrieve again.', 
  account_status_tool: 'Get the account status for the customer using customer id. Customer\'s name can be used instaed of customer\'s id. If the account status is already known do not retrieve again.',
  overall_risk_tool: 'Get overall risk based on combination of both credit score and account status. Explain how the overall risk was calculated. If the credit score and account status are not known then do not provide the risk status and first retrieve the missing credit score or account status.',
  overall_risk_from_rag_llm_tool: 'Get overall risk based on combination of both credit score and account status. Explain how the overall risk was calculated. If the credit score and account status are not known then do not provide the risk status and first retrieve the missing credit score or account status.',
  overall_risk_from_rag_llm_tool_prompt: "what is the risk for credit score {credit_score} and account status {account_status}, and how is it determined?",
  interest_rate_tool: 'Get interest rate percentage based on overall risk. Explain how the interest rate was determined. If the overall risk is not known then do not provide the interest rate status and first retrieve the overall risk.',
  interest_rate_from_rag_llm_tool_prompt: "what is the interest rate for overall risk {overall_risk} and how was it determined?",
  interest_rate_from_rag_llm_tool: 'Get interest rate percentage based on overall risk. If the overall risk is not known then do not provide the interest rate status and first retrieve the overall risk. Explain how the interest rate was determined.',
   
  //NOTE: Also - tbd -- There are additional descriptions for the tool input argumets that impact tool use. 
  //eg schema: z.object({ customer_id: z.string().describe("Customer's id"),

  model: 'watsonx-ChatWatsonx',
  model_minTokens: 150, //not applicable to some models
  model_maxTokens: 250,
  model_temperature: 0.5, // 0 deterministic ie greedy mode
  model_randomSeed: 123, // if temperature is not 0
  model_topP: 1, //0-1 nucleus sampling. ideally not recommneded to use with temperature
  model_topK: 25 // 1-100 lower value keeps on topic
  //NOTE: check model details for which properties are supported by it. 
}

/////////////////////////////////

const webapp: Application = express();
webapp.use(
  session({
    secret: 'your_secret_key', // Replace with a strong, random secret
    resave: false, // Don't save session if unmodified
    saveUninitialized: false, // Don't create session until something is stored
    cookie: {
      maxAge: 1000 * 60 * 60 * 24, // 1 day
      secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
      httpOnly: true, // Prevent client-side JavaScript from accessing the cookie
    },
  })
);

// Serve static files from the 'public' directory
webapp.use(express.static(path.join(__dirname, 'public')));

//webapp.use(express.static("public"));
webapp.use(express.json());

// Define a route for the home page
webapp.get('/', async (req: Request, res: Response) => {
  const options = {
      root: path.join(__dirname)
  };
  //res.sendFile(path.join(__dirname, 'public', 'index-single-agent.html'));
  res.sendFile('public/index-single-agent.html', options);

});

//Define a route for the ai agent application graph processing
webapp.post('/callagent', async (req: Request, res: Response) => {

  req.session.questions = req.session.questions || [];
  req.session.answers = req.session.answers || [];
  console.log('Received request on callagent endpoint.', req.body);
  const input_post_body=req.body;
  //app.use(express.json()) is set in the code and so by default parse all input as JSON
  //changes all input to json already
  //https://expressjs.com/en/api.html#express.json

  //console.log(`request body: ${input_post_body}`);
  console.log('input_post_body:');
  console.log(input_post_body);

  const query = input_post_body.query; //"what is the overall risk for credit score 444?"     ////req.query.q; // 'hello'

  console.log("Setting access_token.");  
  await get_ibm_iam_token();

  //Get input to the graph
  console.log("Input query for agent: ", query);

  const query_response = await runAppWithQuery(query);

  req.session.questions.push(req.body);
  req.session.answers.push(query_response);
  console.log("=============USER",req.session);


  res.send(query_response);


});

/////////////////////////////////


const makePostRequestCallByType = async (calltype: string, post_data: any): Promise<any> => {
  //async function makePostRequest(url: string, data: any): Promise<any> {
    try {
    
        const post_params = { 
            url: '', 
            headers: {},
            data: post_data
        };
        
        if ( calltype === 'get_token') {
            post_params.url = process.env.IBM_IAM_TOKEN_ENDPOINT;
            post_params.headers =  {
              'Accept': 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded'
            }
        } // end if ( calltype === 'get_token') {

        if ( calltype === 'get_risk_from_rag_llm' || calltype === 'get_interest_rate_from_rag_llm' ) {
          post_params.url = process.env.WATSONX_RISK_RAG_LLM_ENDPOINT;
          post_params.headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json;charset=UTF-8',
            'Authorization': 'Bearer ' + process.env.IBM_IAM_TOKEN
          }

        } // end if ( calltype === 'get_risk_from_rag_llm') {


        const response = await fetch(post_params.url, {
          method: 'POST',
          headers: post_params.headers,
          body: post_params.data, //JSON.stringify(data),
        });

        if (!response.ok) {
          console.log('makePostRequestCallByType ERROR:',response);
          throw new Error('Network response was not ok');
        }

        return response.json();



    } catch (error) {
      console.error('Error making POST request:', error);
      throw error;
    }
}

const get_ibm_iam_token = async () => {

  const data="grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=" + process.env.WATSONX_AI_APIKEY;

  var access_token="";

  if ( process.env.IBM_IAM_TOKEN_EXPIRATION === undefined || process.env.IBM_IAM_TOKEN_EXPIRATION === null || parseInt(process.env.IBM_IAM_TOKEN_EXPIRATION) < ( (Date.now()/1000)-300) ) {
    // Token has expired
    console.log("Token has expired process.env.IBM_IAM_TOKEN_EXPIRATION, Date.now()/1000 :",process.env.IBM_IAM_TOKEN_EXPIRATION,Date.now()/1000);
    console.log("Token has expired. Getting new token.");
    await makePostRequestCallByType('get_token',data)
    .then((responseData) => {
    //console.log('Response:', responseData);
    access_token=responseData.access_token;
    //access_token_expiration=responseData.expiration;
    process.env.IBM_IAM_TOKEN=responseData.access_token;
    process.env.IBM_IAM_TOKEN_EXPIRATION=responseData.expiration;    
    //return responseData.access_token;
    })
    .catch((error) => {
    console.error('Error:', error);
    });
  } else {
  // Token is still valid
    console.log("Token is valid. process.env.IBM_IAM_TOKEN_EXPIRATION, Date.now()/1000 :",process.env.IBM_IAM_TOKEN_EXPIRATION,Date.now()/1000);
    console.log("Existing token is valid.");
    access_token=process.env.IBM_IAM_TOKEN;
  }

  return access_token;

};

const setupTools = async () => {

  const todos = await fetchTodos()

    function getRndInteger(min, max) {
        return Math.floor(Math.random() * (max - min + 1) ) + min;
    }

    const getCreditScore = tool( async ({ customer_id } ) => {
            var credit_score = 0;
	    customer_id=customer_id.toLowerCase();
            if (customer_id === "loren@ibm.com" || customer_id === "loren" || customer_id ==="1111" ) {
                    credit_score = 455;
            } else if (customer_id === "matt@ibm.com" || customer_id === "matt" || customer_id === "2222" )  {
                    credit_score = 685;
            } else if (customer_id === "hilda@ibm.com" || customer_id === "hilda" || customer_id === "3333" )  {
                    credit_score = 825;
            } else {
                    credit_score = getRndInteger(300, 850);
            }
            let todos = await fetchTodos();
            return todos[60].id //credit_score; // 555;
        }, {
            name: 'get_credit_score',
            description: agentic_instructions.credit_score_tool,
            schema: z.object({
	       //customer_id: z.string().optional().describe("Customer's id"),
               customer_id: z.string().describe("Customer's id"),
            })
    })


    const getAccountStatus= tool(({ customer_id }) => {
            const status_list = ['delinquent', 'good-standing', 'closed' ];
            var account_status = 'good-standing';
            customer_id=customer_id.toLowerCase();
            if (customer_id === "loren@ibm.com" || customer_id === "loren" || customer_id ==="1111" ) {
                    account_status = 'good-standing' ;
            } else if (customer_id === "matt@ibm.com" || customer_id === "matt" || customer_id === "2222" )  {
                    account_status = 'closed';
            } else if (customer_id === "hilda@ibm.com" || customer_id === "hilda" || customer_id === "3333" )  {
                    account_status = 'delinquent';
            } else {
                    account_status = status_list[getRndInteger(0, 2)];
            }
            return account_status; // ;
        }, {
            name: 'get_account_status',
            description: agentic_instructions.account_status_tool,
            schema: z.object({
               //customer_id: z.string().optional().describe("Customer's id"),
               customer_id: z.string().describe(" "),
            })
    })


    const getOverallRisk= tool(({credit_score, account_status})  => {
            let overall_risk = '';
            //console.log('-----------------');
            //console.log('--->',credit_score, account_status);
            if (credit_score >= 750 && account_status == 'good-standing') {
                    overall_risk = 'low';
            } else if (credit_score >= 750 && account_status == 'closed')  {
                    overall_risk = 'medium';
            } else if (credit_score >= 750 && account_status == 'delinquent')  {
                    overall_risk = 'medium';
            } else if (credit_score < 750 && credit_score >=550 && account_status == 'good-standing')  {
                    overall_risk = 'medium';
            } else if (credit_score < 750 && credit_score >=550 && account_status == 'closed')  {
                    overall_risk = 'high';
            } else if (credit_score < 750 && credit_score >=550 && account_status == 'delinquent')  {
                    overall_risk = 'high';
            } else if (credit_score < 550)  {
                    overall_risk = 'high';
            } else {
                    overall_risk = 'unable to determine';
            }
            //console.log('--->,overall_risk');
            return overall_risk;
        }, {
            name: 'get_overall_risk',
            description: agentic_instructions.overall_risk_tool,
            schema: z.object({
                credit_score: z.number().describe("Credit score"),
                account_status: z.string().describe("Account status")
            })
    })


    const getInterestRate = tool(({ overall_risk } ) => {

            var interest_rate = 0;
            overall_risk=overall_risk.toLowerCase();
            if (overall_risk === "high") {
                interest_rate = 8;
            } else if (overall_risk === "medium") {
                interest_rate = 5;
            } else if (overall_risk === "low") {
                interest_rate = 3;
            } else {
                interest_rate = 12
            }
            return interest_rate;
        }, {
            name: 'get_interest_rate',
            description: agentic_instructions.interest_rate_tool,
            schema: z.object({
               //customer_id: z.string().optional().describe("Customer's id"),
               overall_risk: z.string().describe("Customer's overall risk"),
            })
    })

    const getOverallRiskFromRAGLLM= tool( async ({credit_score, account_status})  => {

      //Call the deployed RAG LLM API endpoint with above query/message content and the the overall risk description.
      const risk_rag_llm_query=agentic_instructions.overall_risk_from_rag_llm_tool_prompt.replace("{credit_score}", credit_score.toString()).replace("{account_status}", account_status);;

      //console.log("risk_rag_llm_query:", risk_rag_llm_query);
      //const payload = '{"messages": [{ "role": "user", "content": "' + risk_rag_llm_query + '" }]}';
      const risk_rag_llm_request_obj = {"messages": [{ "role": "user", "content": risk_rag_llm_query }]};
      const risk_rag_llm_request = JSON.stringify(risk_rag_llm_request_obj);
      console.log('payload:',risk_rag_llm_request);


      const risk_rag_llm_response = await makePostRequestCallByType('get_risk_from_rag_llm',risk_rag_llm_request)
      .then((responseData) => {
        console.log('Response:', responseData);
        return responseData;
      })
      .catch((error) => {
        console.error('Error:', error);
      });

      console.log("risk_rag_llm_response:", risk_rag_llm_response);
      //console.log("choices[]:", risk_rag_llm_response.choices);
      console.log("risk_rag_llm_response.choices[0].message.content:", risk_rag_llm_response.choices[0].message.content);

      const overall_risk = risk_rag_llm_response.choices[0].message.content;

      //const overall_risk = "The risk is high";
      return overall_risk;

      }, {
          name: 'get_overall_risk_from_rag_llm',
          description: agentic_instructions.overall_risk_from_rag_llm_tool,
          schema: z.object({
              credit_score: z.number().describe("Credit score"),
              account_status: z.string().describe("Account status")
          })
    })

    const getInterestRateFromRAGLLM= tool( async ({overall_risk})  => {

      //Call the deployed RAG LLM API endpoint with above query/message content and the interest rate description.
      const interest_rate_rag_llm_query=agentic_instructions.interest_rate_from_rag_llm_tool_prompt.replace("{overall_risk}", overall_risk);

      //console.log("interest_rate_rag_llm_query:", interest_rate_rag_llm_query);
      //const payload = '{"messages": [{ "role": "user", "content": "' + interest_rate_rag_llm_query + '" }]}';
      const interest_rate_rag_llm_query_request_obj = {"messages": [{ "role": "user", "content": interest_rate_rag_llm_query }]};
      const interest_rate_rag_llm_query_request = JSON.stringify(interest_rate_rag_llm_query_request_obj);
      console.log('payload:',interest_rate_rag_llm_query_request);


      const interest_rate_rag_llm_response = await makePostRequestCallByType('get_interest_rate_from_rag_llm',interest_rate_rag_llm_query_request)
      .then((responseData) => {
        console.log('Response:', responseData);
        return responseData;
      })
      .catch((error) => {
        console.error('Error:', error);
      });

      console.log("interest_rate_rag_llm_response:", interest_rate_rag_llm_response);
      //console.log("choices[]:", interest_rate_rag_llm_response.choices);
      console.log("interest_rate_rag_llm_response.choices[0].message.content:", interest_rate_rag_llm_response.choices[0].message.content);

      const interest_rate = interest_rate_rag_llm_response.choices[0].message.content;

      //const interest_rate = 55;
      return interest_rate;

      }, {
          name: 'get_interest_rate_from_rag_llm',
          description: agentic_instructions.interest_rate_from_rag_llm_tool,
          schema: z.object({
              overall_risk: z.string().describe("Overall risk")
          })
    })


  console.log("Checking process.env.ENABLE_RAG_LLM for RAG LLM use in tool.", process.env.ENABLE_RAG_LLM);
  if (process.env.ENABLE_RAG_LLM.toLowerCase()==='true') {
    console.log("Enabling use of RAG LLM in tool");
    const tools = [getCreditScore, getAccountStatus, getOverallRiskFromRAGLLM, getInterestRateFromRAGLLM ]
    return tools;
  } else {
    const tools = [getCreditScore, getAccountStatus, getOverallRisk, getInterestRate ]
    return tools;
  }

};

///

const setupModelWithTools = async (tools: Array<any>) => {

    if ( agentic_instructions.model == 'watsonx-ChatWatsonx' ) {
    //props for meta-llama/llama-3-2-90b-vision-instruct or other models
    console.log('Using watsonx-ChatWatsonx');
    const props = {
        minTokens: agentic_instructions.model_minTokens,// 150,
        maxTokens: agentic_instructions.model_maxTokens, //250,
        temperature: agentic_instructions.model_temperature, //0.5,
        randomSeed: agentic_instructions.model_randomSeed //12345
    };


    const modelWithTools = new ChatWatsonx({
        watsonxAIAuthType: "iam",
		model: "ibm/granite-4-h-small",
		//model: "meta-llama/llama-3-2-90b-vision-instruct",
        //model: "mistralai/mistral-large", #deprecated
        //model: "ibm/granite-3-8b-instruct",
        //model: "meta-llama/llama-3-1-70b-instruct",
        //apikey: process.env.WATSONX_AI_APIKEY,
        projectId: process.env.WATSONX_PROJECT_ID,
        serviceUrl: process.env.WATSONX_SERVICE_URL,
        version: '2024-05-31',
        ...props,
        }).bindTools(tools);
        
        return modelWithTools;
    }; // end if watsonx-ChatWatsonx',
};

const setupApp = async (tools: Array<any>, modelWithTools) => {

    const toolNodeForGraph = new ToolNode(tools)
    
    const shouldContinue = (state) => {
    const { messages } = state;
    const lastMessage = messages[messages.length - 1];
    //console.log("lastMessage.tool_calls?.length::::",lastMessage.tool_calls?.length);
    if ("tool_calls" in lastMessage && Array.isArray(lastMessage.tool_calls) && lastMessage.tool_calls?.length) {
        return "tools";
    }
    return END;
    }

    const callModel = async (state) => {
        const { messages } = state;
        const response = await modelWithTools.invoke(messages);
        return { messages: response };
    }

    const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", toolNodeForGraph)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue, ["tools", END])
    .addEdge("tools", "agent");

    const app = workflow.compile()

    return app;

};


////////////////////////////////

const tools = await setupTools();

const modelWithTools = await setupModelWithTools(tools);

const app = await setupApp(tools,modelWithTools);

/////////////////////////////////

const runAppWithQuery = async (query: string) => {

    console.log("\n=====START======");

    const stream = await app.stream(
    {
       //messages: [{ role: "user", content: query }],
       messages: [new HumanMessage({content: query })]
    },
    {
        streamMode: "values"
    }
    )

    const chat_messages=[];

    for await (const chunk of stream) {
        const lastMessage = chunk.messages[chunk.messages.length - 1];
        const type = lastMessage._getType();
        const content = lastMessage.content;
        const toolCalls = lastMessage.tool_calls;
        console.dir({
            type,
            content,
            toolCalls
        }, { depth: null });
        chat_messages.push({
            type,
            content,
            toolCalls
        });
    }

    //const result = "Result from the agent is the in final message.";
    //console.log("Agent result: ", result);
    console.log("\n=====END======");

    return chat_messages;
}

////////////////////////////

webapp.listen(process.env.APPLICATION_PORT, () => {
  console.log(`Agentic AI application ${process.env.APPLICATION_NAME} is starting...`);
  console.log(`Server is running on http://<your-server-ip>:${process.env.APPLICATION_PORT}`);
});









