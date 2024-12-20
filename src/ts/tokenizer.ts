import type { Tiktoken } from "@dqbd/tiktoken";
import type { Tokenizer } from "@mlc-ai/web-tokenizers";
import { type groupChat, type character, type Chat, getCurrentCharacter, getDatabase } from "./storage/database.svelte";
import type { MultiModal, OpenAIChat } from "./process/index.svelte";
import { supportsInlayImage } from "./process/files/image";
import { risuChatParser } from "./parser.svelte";
import { tokenizeGGUFModel } from "./process/models/local";
import { globalFetch } from "./globalApi.svelte";


export const tokenizerList = [
    ['tik', 'Tiktoken (OpenAI)'],
    ['mistral', 'Mistral'],
    ['novelai', 'NovelAI'],
    ['claude', 'Claude'],
    ['llama', 'Llama'],
    ['llama3', 'Llama3'],
    ['novellist', 'Novellist'],
    ['gemma', 'Gemma'],
    ['cohere', 'Cohere'],
] as const

export async function encode(data:string):Promise<(number[]|Uint32Array|Int32Array)>{
    let db = getDatabase()
    if(db.aiModel === 'openrouter' || db.aiModel === 'reverse_proxy'){
        switch(db.customTokenizer){
            case 'mistral':
                return await tokenizeWebTokenizers(data, 'mistral')
            case 'llama':
                return await tokenizeWebTokenizers(data, 'llama')
            case 'novelai':
                return await tokenizeWebTokenizers(data, 'novelai')
            case 'claude':
                return await tokenizeWebTokenizers(data, 'claude')
            case 'novellist':
                return await tokenizeWebTokenizers(data, 'novellist')
            case 'llama3':
                return await tokenizeWebTokenizers(data, 'llama')
            case 'gemma':
                return await tokenizeWebTokenizers(data, 'gemma')
            case 'cohere':
                return await tokenizeWebTokenizers(data, 'cohere')
            default:
                // Add exception for gpt-4o tokenizers on reverse_proxy
                if(db.proxyRequestModel?.startsWith('gpt4o') || 
                (db.proxyRequestModel === 'custom' && db.customProxyRequestModel.startsWith('gpt-4o'))) {
                    return await tikJS(data, 'o200k_base')
                }
                return await tikJS(data)
        }
    }
    if(db.aiModel.startsWith('novellist')){
        const nv= await tokenizeWebTokenizers(data, 'novellist')
        return nv
    }
    if(db.aiModel.startsWith('claude')){
        return await tokenizeWebTokenizers(data, 'claude')
    }
    if(db.aiModel.startsWith('novelai')){
        return await tokenizeWebTokenizers(data, 'novelai')
    }
    if(db.aiModel.startsWith('mistral')){
        return await tokenizeWebTokenizers(data, 'mistral')
    }
    if(db.aiModel === 'mancer' ||
        db.aiModel === 'textgen_webui' ||
        (db.aiModel === 'reverse_proxy' && db.reverseProxyOobaMode)){
        return await tokenizeWebTokenizers(data, 'llama')
    }
    if(db.aiModel.startsWith('local_')){
        return await tokenizeGGUFModel(data)
    }
    if(db.aiModel === 'ooba'){
        if(db.reverseProxyOobaArgs.tokenizer === 'mixtral' || db.reverseProxyOobaArgs.tokenizer === 'mistral'){
            return await tokenizeWebTokenizers(data, 'mistral')
        }
        else if(db.reverseProxyOobaArgs.tokenizer === 'llama'){
            return await tokenizeWebTokenizers(data, 'llama')
        }
        else{
            return await tokenizeWebTokenizers(data, 'llama')
        }
    }
    if(db.aiModel.startsWith('gpt4o')){
        return await tikJS(data, 'o200k_base')
    }
    if(db.aiModel.startsWith('gemini')){
        return await tokenizeWebTokenizers(data, 'gemma')
    }
    if(db.aiModel.startsWith('cohere')){
        return await tokenizeWebTokenizers(data, 'cohere')
    }

    return await tikJS(data)
}

type tokenizerType = 'novellist'|'claude'|'novelai'|'llama'|'mistral'|'llama3'|'gemma'|'cohere'

let tikParser:Tiktoken = null
let tokenizersTokenizer:Tokenizer = null
let tokenizersType:tokenizerType = null
let lastTikModel = 'cl100k_base'

async function tikJS(text:string, model='cl100k_base') {
    if(!tikParser || lastTikModel !== model){
        if(model === 'cl100k_base'){
            const {Tiktoken} = await import('@dqbd/tiktoken')
            const cl100k_base = await import("@dqbd/tiktoken/encoders/cl100k_base.json");
            lastTikModel = model   
        
            tikParser = new Tiktoken(
                cl100k_base.bpe_ranks,
                cl100k_base.special_tokens,
                cl100k_base.pat_str
            );
        }
        if(model === 'o200k_base'){
            const {Tiktoken} = await import('@dqbd/tiktoken')
            const o200k_base = await import("src/etc/o200k_base.json");
            lastTikModel = model
            tikParser = new Tiktoken(
                o200k_base.bpe_ranks,
                o200k_base.special_tokens,
                o200k_base.pat_str
            );
        }
    }
    return tikParser.encode(text)
}

async function geminiTokenizer(text:string) {
    const db = getDatabase()
    const fetchResult = await globalFetch(`https://generativelanguage.googleapis.com/v1beta/${db.aiModel}:countTextTokens`, {
        "headers": {
            "content-type": "application/json",
            "authorization": `Bearer ${db.google.accessToken}`
        },
        "body": JSON.stringify({
            "prompt":{
                text: text
            }
        }),
        "method": "POST"
    })

    if(!fetchResult.ok){
        //fallback to tiktoken
        return await tikJS(text)
    }

    const result = fetchResult.data

    return result.tokenCount ?? 0
}

async function tokenizeWebTokenizers(text:string, type:tokenizerType) {
    if(type !== tokenizersType || !tokenizersTokenizer){
        const webTokenizer = await import('@mlc-ai/web-tokenizers')
        switch(type){
            case "novellist":
                tokenizersTokenizer = await webTokenizer.Tokenizer.fromSentencePiece(
                    await (await fetch("/token/trin/spiece.model")
                ).arrayBuffer())
                break
            case "claude":
                tokenizersTokenizer = await webTokenizer.Tokenizer.fromJSON(
                    await (await fetch("/token/claude/claude.json")
                ).arrayBuffer())
                break
            case 'llama3':
                tokenizersTokenizer = await webTokenizer.Tokenizer.fromJSON(
                    await (await fetch("/token/llama/llama3.json")
                ).arrayBuffer())
                break
            case 'cohere':
                tokenizersTokenizer = await webTokenizer.Tokenizer.fromJSON(
                    await (await fetch("/token/cohere/tokenizer.json")
                ).arrayBuffer())
                break
            case 'novelai':
                tokenizersTokenizer = await webTokenizer.Tokenizer.fromSentencePiece(
                    await (await fetch("/token/nai/nerdstash_v2.model")
                ).arrayBuffer())
                
                break
            case 'llama':
                tokenizersTokenizer = await webTokenizer.Tokenizer.fromSentencePiece(
                    await (await fetch("/token/llama/llama.model")
                ).arrayBuffer())
                break
            case 'mistral':
                tokenizersTokenizer = await webTokenizer.Tokenizer.fromSentencePiece(
                    await (await fetch("/token/mistral/tokenizer.model")
                ).arrayBuffer())
                break
            case 'gemma':
                tokenizersTokenizer = await webTokenizer.Tokenizer.fromSentencePiece(
                    await (await fetch("/token/gemma/tokenizer.model")
                ).arrayBuffer())
                break

        }
        tokenizersType = type
    }
    return (tokenizersTokenizer.encode(text))
}

export async function tokenizerChar(char:character) {
    const encoded = await encode(char.name + '\n' + char.firstMessage + '\n' + char.desc)
    return encoded.length
}

export async function tokenize(data:string) {
    const encoded = await encode(data)
    return encoded.length
}

export async function tokenizeAccurate(data:string, consistantChar?:boolean) {
    data = risuChatParser(data.replace('{{slot}}',''), {
        tokenizeAccurate: true,
        consistantChar: consistantChar,
    })
    const encoded = await encode(data)
    return encoded.length
}


export class ChatTokenizer {

    private chatAdditonalTokens:number
    private useName:'name'|'noName'

    constructor(chatAdditonalTokens:number, useName:'name'|'noName'){
        this.chatAdditonalTokens = chatAdditonalTokens
        this.useName = useName
    }
    async tokenizeChat(data:OpenAIChat) {
        let encoded = (await encode(data.content)).length + this.chatAdditonalTokens
        if(data.name && this.useName ==='name'){
            encoded += (await encode(data.name)).length + 1
        }
        if(data.multimodals && data.multimodals.length > 0){
            for(const multimodal of data.multimodals){
                encoded += await this.tokenizeMultiModal(multimodal)
            }
        }
        return encoded
    }

    async tokenizeMultiModal(data:MultiModal){
        const db = getDatabase()
        if(!supportsInlayImage()){
            return this.chatAdditonalTokens
        }
        if(db.gptVisionQuality === 'low'){
            return 87
        }

        let encoded = this.chatAdditonalTokens
        let height = data.height ?? 0
        let width = data.width ?? 0

        if(height === width){
            if(height > 768){
                height = 768
                width = 768
            }
        }
        else if(height > width){
            if(width > 768){
                width = 768
                height = height * (768 / width)
            }
        }
        else{
            if(height > 768){
                height = 768
                width = width * (768 / height)
            }
        }

        const chunkSize = Math.ceil(width / 512) * Math.ceil(height / 512)
        encoded += chunkSize * 2
        encoded += 85

        return encoded
    }
    
}

export async function tokenizeNum(data:string) {
    const encoded = await encode(data)
    return encoded
}

export async function strongBan(data:string, bias:{[key:number]:number}) {

    if(localStorage.getItem('strongBan_' + data)){
        return JSON.parse(localStorage.getItem('strongBan_' + data))
    }
    const performace = performance.now()
    const length = Object.keys(bias).length
    let charAlt = [
        data,
        data.trim(),
        data.toLocaleUpperCase(),
        data.toLocaleLowerCase(),
        data[0].toLocaleUpperCase() + data.slice(1),
        data[0].toLocaleLowerCase() + data.slice(1),
    ]

    let banChars = " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~“”‘’«»「」…–―※"
    let unbanChars:number[] = []

    for(const char of banChars){
        unbanChars.push((await tokenizeNum(char))[0])
    }



    for(const char of banChars){
        const encoded = await tokenizeNum(char)
        if(encoded.length > 0){
            if(!unbanChars.includes(encoded[0])){
                bias[encoded[0]] = -100
            }
        }
        for(const alt of charAlt){
            let fchar = char

            const encoded = await tokenizeNum(alt + fchar)
            if(encoded.length > 0){
                if(!unbanChars.includes(encoded[0])){
                    bias[encoded[0]] = -100
                }
            }
            const encoded2 = await tokenizeNum(fchar + alt)
            if(encoded2.length > 0){
                if(!unbanChars.includes(encoded2[0])){
                    bias[encoded2[0]] = -100
                }
            }
        }
    }
    localStorage.setItem('strongBan_' + data, JSON.stringify(bias))
    return bias
}

export async function getCharToken(char?:character|groupChat|null){
    let persistant = 0
    let dynamic = 0

    if(!char){
        const c = getCurrentCharacter()
        char = c
    }
    if(char.type === 'group'){
        return {persistant:0, dynamic:0}
    }

    const basicTokenize = async (data:string) => {
        data = data.replace(/{{char}}/g, char.name).replace(/<char>/g, char.name)
        return await tokenize(data)
    }

    persistant += await basicTokenize(char.desc)
    persistant += await basicTokenize(char.personality ?? '')
    persistant += await basicTokenize(char.scenario ?? '')
    for(const lore of char.globalLore){
        let cont = lore.content.split('\n').filter((line) => {
            if(line.startsWith('@@')){
                return false
            }
            if(line === ''){
                return false
            }
            return true
        }).join('\n')
        dynamic += await basicTokenize(cont)
    }

    return {persistant, dynamic}
}

export async function getChatToken(chat:Chat) {
    let persistant = 0

    const chatTokenizer = new ChatTokenizer(0, 'name')
    const chatf = chat.message.map((d) => {
        return {
            role: d.role === 'user' ? 'user' : 'assistant',
            content: d.data,
        } as OpenAIChat
    })
    for(const chat of chatf){
        persistant += await chatTokenizer.tokenizeChat(chat)
    }

    return persistant
}