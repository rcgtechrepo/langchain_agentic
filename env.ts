import fs from 'fs';

export function setEnvironment() {

    //Pre configured required environment variables
    process.env.APPLICATION_NAME = "LoanRisk-AIAgent";
    process.env.WATSONX_AI_AUTH_TYPE = "iam"
    process.env.IBM_IAM_TOKEN_ENDPOINT = "https://iam.cloud.ibm.com/identity/token"

    //Set these REQUIRED environment variables as part of the deployment

    //REQUIRED environment variables
    //process.env.APPLICATION_PORT="8080"; //default is 8080. If using Docker, it must be same in Dockerfile.

    //REQUIRED environment variables when using IBM Cloud watsonx.ai platform LLMs
    //process.env.WATSONX_AI_APIKEY="xxxxxxxxxxx"
    //process.env.WATSONX_SERVICE_URL="https://us-south.ml.cloud.ibm.com" //default is us-south region
    //process.env.WATSONX_PROJECT_ID="xxx-xxx-xxx-xxx-xxx"

    //Optional - For using RAG LLM set rag llm watsonx environment variables to set in deployment
    //process.env.ENABLE_RAG_LLM = "true" //default is false. true requires WATSONX_RISK_RAG_LLM_ENDPOINT; 
    //process.env.WATSONX_RISK_RAG_LLM_ENDPOINT="https://private.us-south.ml.cloud.ibm.com/ml/v4/deployments/xxx-xxx-xxx-xxx-xxx/ai_service?version=2021-05-01";

    //Optional - For using watsonx Assistant. Creates a /wx.html webpage with the chat widget
    //process.env.ENABLE_WXASST="true" //default is false. true requires the other WXASST_ variables. These are available in the Embed script of the watsonx assistant
    //process.env.WXASST_INTEGRATION_ID="xxx-xxx-xxx-xx-xx"
    //process.env.WXASST_REGION="xx-xxx" 
    //process.env.WXASST_SERVICE_INSTANCE_ID="xxx-xxxx-xxx-xx-x"

    //environment variables set by functions in the code
    //process.env.IBM_IAM_TOKEN="to be set by function"
    //process.env.IBM_IAM_TOKEN_EXPIRATION="to be set by function"

    //Validate the environment variables. Set defaults when not provided.
    if (process.env.WATSONX_AI_APIKEY) {
        console.log("Setting process.env.WATSONX_AI_APIKEY from envars:", process.env.WATSONX_AI_APIKEY);
    } else {
        console.error("WATSONX_AI_APIKEY envar is not set.");
    }

    if (process.env.WATSONX_PROJECT_ID) {
        console.log("Setting process.env.WATSONX_PROJECT_ID from envars:", process.env.WATSONX_PROJECT_ID);
    } else {
        console.error("WATSONX_PROJECT_ID envar is not set.");
    }

    if (process.env.APPLICATION_PORT) {
        console.log("Setting process.env.APPLICATION_PORT from envars:", process.env.APPLICATION_PORT);
    } else {
        process.env.APPLICATION_PORT = "8080";
        console.log("Using default process.env.APPLICATION_PORT:", process.env.APPLICATION_PORT);
    }

    if (process.env.WATSONX_SERVICE_URL) {
        console.log("Setting process.env.WATSONX_SERVICE_URL from envars:", process.env.WATSONX_SERVICE_URL);
    } else {
        process.env.WATSONX_SERVICE_URL = "https://us-south.ml.cloud.ibm.com";
        console.log("Using default process.env.WATSONX_SERVICE_URL:", process.env.WATSONX_SERVICE_URL);
    }

    if (process.env.ENABLE_RAG_LLM) {
        console.log("Using process.env.ENABLE_RAG_LLM from envars:", process.env.ENABLE_RAG_LLM);
        if (process.env.ENABLE_RAG_LLM.toLowerCase() === 'true') {
            //console.log("Setting process.env.ENABLE_RAG_LLM from envars:", process.env.ENABLE_RAG_LLM);
            console.log("Requires WATSONX_RISK_RAG_LLM_ENDPOINT from envars. Uses bearer token using WATSONX_AI_APIKEY from envars.");
            if (process.env.WATSONX_RISK_RAG_LLM_ENDPOINT) {
                console.log("Setting process.env.WATSONX_RISK_RAG_LLM_ENDPOINT from envars:", process.env.WATSONX_RISK_RAG_LLM_ENDPOINT);
            } else {
                console.error("WATSONX_RISK_RAG_LLM_ENDPOINT envar is not set.");
            }
        }
    } else {
        process.env.ENABLE_RAG_LLM = "false";
        console.log("Using default process.env.ENABLE_RAG_LLM:", process.env.ENABLE_RAG_LLM);
    }

    if (process.env.ENABLE_WXASST) {
        if (process.env.ENABLE_WXASST.toLowerCase() === 'true') {
            console.log("Setting up watsonx Assistant widget for page /wx.html. Envar ENABLE_WXASST:", process.env.ENABLE_WXASST);
            if (process.env.WXASST_INTEGRATION_ID && process.env.WXASST_REGION && process.env.WXASST_SERVICE_INSTANCE_ID) {
                fs.readFile('public/wx-template.html', 'utf8', function(err, data) {
                    if (err) {
                        return console.log(err);
                    }
                    var result1 = data.replace('[[[WXASST_INTEGRATION_ID]]]', process.env.WXASST_INTEGRATION_ID);
                    var result2 = result1.replace('[[[WXASST_REGION]]]', process.env.WXASST_REGION);
                    var result3 = result2.replace('[[[WXASST_SERVICE_INSTANCE_ID]]]', process.env.WXASST_SERVICE_INSTANCE_ID);

                    fs.writeFile('public/wx.html', result3, 'utf8', function(err) {
                        if (err) return console.log(err);
                    });
                });
                fs.readFile('public/wx-template2.html', 'utf8', function(err, data) {
                    if (err) {
                        return console.log(err);
                    }
                    var result1 = data.replace('[[[WXASST_INTEGRATION_ID]]]', process.env.WXASST_INTEGRATION_ID);
                    var result2 = result1.replace('[[[WXASST_REGION]]]', process.env.WXASST_REGION);
                    var result3 = result2.replace('[[[WXASST_SERVICE_INSTANCE_ID]]]', process.env.WXASST_SERVICE_INSTANCE_ID);

                    fs.writeFile('public/wx-detailed.html', result3, 'utf8', function(err) {
                        if (err) return console.log(err);
                    });
                });
            } else {
                console.log("Unable to set up watsonx Assistant widget. Missing one or more envars from WXASST_INTEGRATION_ID, WXASST_REGION, WXASST_SERVICE_INSTANCE_ID,");
            }
        }
    }
}