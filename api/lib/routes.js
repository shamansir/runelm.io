// @flow weak

const Promise = require('bluebird')
const request = require('request-promise')
const jsonFormatter = require('format-json')

const util = require('./util')
const fs = require('fs-extra')

const createRoutes = ({
  insertUser,
  snippetById,
  auth,
  compile,
  createAuthUri,
  decodeAccessToken,
  authFinishedRedirect,
}) => {


  const snippetResult = (req, res) => {
    compile(req.params.snippet)
    .then(html => res.send(html))
  }

  const githubLogin = (req, res) => {
    const { token } = req.query

    const authorizationUri = createAuthUri(token)
    res.redirect(authorizationUri)
  }

  const githubOAuthCallback = (req, res, next) => {
    const { code, state } = req.query

    decodeAccessToken(code)
    .then(data => {
      const { access_token } = data.token

      const options = {
        uri: 'https://api.github.com/user',
        qs: { access_token },
        headers: { 'User-Agent': 'runelm' },
        json: true,
      }

      return request(options)
    })
    .then(res => {
      const user = {
        id: res.login,
        name: res.name,
        email: res.email,
        avatarUrl: res.avatar_url,
      }

      const insert = insertUser(user)

      return Promise.props({
        id: user.id,
        insert,
      })
    })
    .then(({ id }) => {
      let current
      try {
        current = JSON.parse(state)
      }
      catch (e) {
        current = {}
      }

      const context = {
        auth: auth.decodeAuthorization('Bearer ' + current.currentToken)
      }

      return Promise.props({
        id,
        assign: auth.assignCurrentSnippets(context, id),
      })
    })
    .then(({ id }) => {
      const token = auth.createJWT({ github: id })
      res.redirect(authFinishedRedirect(token))
    })
  }


  const snippetDownload = (req, res) => {
    snippetById(req.params.snippet)
    .then(data => {
      if (!data) return res.status(404).end()

      const target = `runelm-snippet-${data.id}`
      const folder = `/tmp/archive-${(new Date()).getTime()}/${target}/`
      fs.ensureDirSync(folder)

      data.files.map(file => {
        fs.writeFileSync(folder + file.filename, file.content)
      })

      const elmjson = util.createElmPackageJson(data)
      fs.writeFileSync(`${folder}elm-package.json`, jsonFormatter.plain(elmjson))

      const { spawn } = require('child_process')

      const zipName = target + '.zip'
      const zip = spawn('zip', ['-r', zipName, target], { cwd: folder + '..' })

      zip.on('exit', code => {
        if (code === 0) {
          res.download(folder + '../' + zipName, zipName)
        }
        else {
          res.status(500).end()
        }

        fs.removeSync(folder)
      })
    })
  }



  return {
    githubLogin,
    githubOAuthCallback,
    snippetResult,
    snippetDownload,
  }
}




module.exports = createRoutes
