import fs from 'fs';
import { CloudWatchLogsClient, StartQueryCommand, GetQueryResultsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { Command } from 'commander';
import dotenv from 'dotenv';

dotenv.config();

const client = new CloudWatchLogsClient({ region: "us-east-1" });

function saveBase64ToFile(base64String, filePath) {
    const buffer = Buffer.from(base64String, 'base64');
    fs.writeFileSync(filePath, buffer);
}

function extractJsonFromString(logMessage) {
    const jsonStringMatch = logMessage.match(/event request: ({.*})/);
    if (jsonStringMatch?.[1]) {
        try {
            const jsonObject = JSON.parse(jsonStringMatch[1]);
            return jsonObject;
        } catch (error) {
            console.error("Error parsing JSON:", error);
        }
    } else {
        console.error("No JSON found in the log message.");
    }
    return null;
}

async function getLogs(lojaId, startDate) {
    const endDate = new Date(startDate);
    endDate.setMinutes(endDate.getMinutes() + 1);

    const startDateObj = new Date(startDate);
    startDateObj.setMinutes(startDateObj.getMinutes() - 1);

    const startQueryCommand = new StartQueryCommand({
        logGroupName: "/aws/lambda/NWT-Core",
        startTime: Math.floor(startDateObj.getTime() / 1000),
        endTime: Math.floor(endDate.getTime() / 1000),
        queryString: `fields @timestamp, @message | filter httpMethod = 'POST' and path like /${lojaId}\\/certificado/ and @message like /event request/ | sort @timestamp desc`,
    });

    try {
        const startQueryResponse = await client.send(startQueryCommand);
        const queryId = startQueryResponse.queryId;

        let queryResults;
        while (true) {
            const getQueryResultsCommand = new GetQueryResultsCommand({ queryId });
            const getQueryResultsResponse = await client.send(getQueryResultsCommand);

            if (getQueryResultsResponse.status === "Complete") {
                queryResults = getQueryResultsResponse.results;
                break;
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        const result = queryResults[0].find((v) => v.field === '@message');
        const json = extractJsonFromString(result.value);
        const certData = JSON.parse(json.body);
        saveBase64ToFile(certData.arquivo, `./cert-${certData.senha}.pfx`);
        return certData;
    } catch (error) {
        console.error("Error fetching logs:", error);
    }
}

let lojaId = null;
let startDate = null;

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
    // Executando via F5 no VSCode
    console.log("Executando via F5 no VSCode");
    lojaId = 'c28dc764-aea5-4bea-acc3-f3fc7a8fb59b';
    startDate = '2025-02-17T22:39:20';
} else {
    const program = new Command();
    program
        .requiredOption('-l, --lojaId <lojaId>', 'ID da loja')
        .requiredOption('-u, --uploadDateTime <startDate>', 'Data de início no fuso horário -3 (aaaa-mm-ddThh:mm:ss)');
    
    program.parse(process.argv);
    
    const options = program.opts();
    lojaId = options.lojaId;
    startDate = options.startDate;
};
getLogs(lojaId, startDate).then((result) => {
    if (result) {
        console.log(`Certificado extraido com sucesso, arquivo cert-${result.senha}.pfx`);
    }
});
