"use strict";
let context = {};
let baseUrl, accessToken, user;

chrome.runtime.onMessage.addListener(() => {
  if($('.github').length === 0) {
    initContext()
    .then(initLambdaList)
    .then(initPageContent)
    .then(getGithubRepos)
    .then(updateRepo)
    .then(updateBranch)
    .catch((err) => {
      switch (err.message) {
        case "need login" :
          initLoginContent();
          break;
        case "nothing" :
          break;
        default:
          console.log(err);
      }
    });
  }
});

$(() => {
  //bind ui event handler
  $.ajaxSetup({ cache: false });
  $(document).on('click', '#github-bind-repo', (event) => {
    $('.github-repo-dropdown').show();
  });
  $(document).on('click', '#github-bind-branch', (event) => {
    $('.github-branch-dropdown').show();
  });
  $(document).on('click', '#github-new-repo', showCreateRepo);
  $(document).on('input propertychange', '#new-repo-name', (event) => {
    changeButtonState('repo', event.target.value);
  })
  $(document).on('click', '.github-repo-model-dismiss', (event) => {
    changeModelState('repo', false);
  })
  $(document).on('click', '#github-create-repo', (event) => {
    changeModelState('repo', false);
    githubCreateRepo();
  });

  $(document).on('click', '#github-new-branch', showCreateBranch);
  $(document).on('input propertychange', '#new-branch-name', (event) => {
    changeButtonState('branch', event.target.value);
  })
  $(document).on('click', '.github-branch-model-dismiss', (event) => {
    changeModelState('branch', false);
  })
  $(document).on('click', '#github-create-branch', (event) => {
    changeModelState('branch', false);
    githubCreateBranch();
  });

  $(document).on('click', '.github-diff-model-dismiss', (event) => {
    changeModelState('diff', false);
  })

  $(document).on('click', '.github-alert-dismiss', (event) => {
    $(event.target).parents('.github-alert').remove();
  });

  $(document).on('click', '#github-pull', githubPull);
  $(document).on('click', '#github-push', githubPush);
  $(document).on('click', '#github-login', (event) => {
    if (chrome.runtime.openOptionsPage) {
      // New way to open options pages, if supported (Chrome 42+).
      chrome.runtime.openOptionsPage();
    } else {
      // Reasonable fallback.
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });
  $(document).on('click', '.github-repo', (event) => {
    if (context.repo && event.target.text === context.repo.name) return;
    //update context.repo with name and fullName
    const name = event.target.text;
    const fullName = event.target.attributes.data.value;
    const repo = {
      name: name,
      fullName : fullName
    }
    context.repo = repo;
    Object.assign(context.bindRepo, { [context.functionName] : repo });
    if (context.bindBranch[context.functionName]) {
      delete context.bindBranch[context.functionName];
    }
    chrome.storage.sync.set({ bindRepo: context.bindRepo }, () => {
      $('#github-bind-repo').text(`Repo: ${name}`);
      $('.github-repo-dropdown').hide();
      updateBranch(name);
    });
  });

  $(document).on('click', '.github-branch', (event) => {
    if (context.branch && event.target.text === context.branch) return;
    //update context.branch and save to storage
    const branch = event.target.text;
    context.branch = branch;
    Object.assign(context.bindBranch, { [context.functionName] : branch });
    chrome.storage.sync.set({ bindBranch: context.bindBranch }, () => {
      $('#github-bind-branch').text(`Branch: ${branch}`);
      $('.github-branch-dropdown').hide();
    });
  });

  $(document).mouseup((event) => {
    //hide repo list
    let repo_container = $('.github-repo-dropdown');
    if (!repo_container.is(event.target) 
      && !$('#github-bind-repo').is(event.target)
      && repo_container.has(event.target).length === 0) {
      repo_container.hide();
    }
    //hide branch list
    let branch = $('.github-branch-dropdown');
    if (!branch.is(event.target) 
      && !$('#github-bind-branch').is(event.target)
      && branch.has(event.target).length === 0) {
      branch.hide();
    }
  });
});

function checkDiff() {
  return Promise.all([
    $.getJSON(
      `${baseUrl}/repos/${context.repo.fullName}/contents/${context.file}?ref=${context.branch}`,
      { access_token: accessToken }
    )
    .then((data) => {
      return $.get(data.download_url);
    }),
    $.ajax({
      url: 'https://' + context.endpoint + '/lambda/services/ajax?operation=getFunctionCode',
      headers: {
        "X-Csrf-Token" : context.csrf
      },
      method: 'POST',
      crossDomain: true,
      dataType: 'json',
      contentType: 'application/json',
      data: JSON.stringify({
        functionName: context.functionName,
        qualifier: context.qualifier,
        operation: "getFunctionCode"
      })
    })
  ])
  .then((data) => {
    const diff = JsDiff.createTwoFilesPatch(context.file, context.file, data[0], data[1].code);
    const diffHtml = new Diff2HtmlUI({diff : diff});
    diffHtml.draw('.github-diff', {inputFormat: 'json', outputFormat:'side-by-side', showFiles: false});
    diffHtml.highlightCode('.github-diff');
    changeModelState('diff', true);
    return {
      github: data[0],
      lambda: data[1].code
    }
  })  
}

function githubPull() {
  checkDiff()
  // .then((data) => {
  //   const payload = {
  //     operation: "updateFunctionCode",
  //     codeSource: "inline",
  //     functionName: context.functionName,
  //     handler: context.current.handler,
  //     runtime: context.current.runtime,
  //     inline: data.github
  //   };
  //   return $.ajax({
  //     url: 'https://' + context.endpoint + '/lambda/services/ajax?operation=updateFunctionCode',
  //     headers: {
  //       "X-Csrf-Token" : context.csrf
  //     },
  //     method: 'POST',
  //     crossDomain: true,
  //     contentType: 'application/json',
  //     data: JSON.stringify(payload)
  //   });
  // })
  // .then(() => {
  //   console.log("pull ok");
  //   location.reload();
  // })
  // .catch((err) => {
  //   showAlert("Failed to pull", "error");
  // });
}

function githubPush() {
  checkDiff()
  .then((data) => {
    const payload = {
      content: data.lambda,
      encoding: "utf-8"
    };
    return $.ajax({
      url: `${baseUrl}/repos/${context.repo.fullName}/git/blobs`,
      headers: {
        "Authorization": `token ${accessToken}`
      },
      method: 'POST',
      crossDomain: true,
      dataType: 'json',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    });
  })
  .then((response) => {
    return $.getJSON(
      `${baseUrl}/repos/${context.repo.fullName}/branches/${context.branch}`,
      { access_token: accessToken }
    )
    .then((branch) => {
      return Object.assign(response, 
      {
        base_tree: branch.commit.commit.tree.sha,
        parent: branch.commit.sha
      });
    });
  })
  .then((response) => {
    const payload = {
      base_tree: response.base_tree,
      tree : [{
        path: context.file,
        mode: "100644",
        type: "blob",
        sha: response.sha
      }]
    };
    return $.ajax({
      url: `${baseUrl}/repos/${context.repo.fullName}/git/trees`,
      headers: {
        "Authorization": `token ${accessToken}`
      },
      method: 'POST',
      crossDomain: true,
      dataType: 'json',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    })
    .then((treeResponse) => {
      return Object.assign(treeResponse, { parent: response.parent })
    });
  })
  .then((response) => {
    const payload = {
      message: "commit from lambda",
      tree: response.sha,
      parents: [
        response.parent
      ]
    };
    return $.ajax({
      url: `${baseUrl}/repos/${context.repo.fullName}/git/commits`,
      headers: {
        "Authorization": `token ${accessToken}`
      },
      method: 'POST',
      crossDomain: true,
      dataType: 'json',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    });
  })
  .then((response) => {
     const payload = {
      force: true,
      sha: response.sha
    };
    return $.ajax({
      url: `${baseUrl}/repos/${context.repo.fullName}/git/refs/heads/${context.branch}`,
      headers: {
        "Authorization": `token ${accessToken}`
      },
      method: 'PATCH',
      crossDomain: true,
      dataType: 'json',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    });
  })
  .then(() => {
    showAlert(`Successfully push to ${context.branch} of ${context.repo.name}`);
    console.log("push ok");
  })
  .catch((err) => {
    console.log(err);
    showAlert("Failed to push", "error");
  });
}

function githubCreateRepo() {
  const repo = $('#new-repo-name').val();
  const desc = $('#new-repo-desc').val();
  const payload = {
    name : repo,
    description : desc
  }
  if (!repo || repo === "") return;
  $.ajax({
    url: `${baseUrl}/user/repos`,
    headers: {
      "Authorization": `token ${accessToken}`
    },
    method: 'POST',
    crossDomain: true,
    dataType: 'json',
    contentType: 'application/json',
    data: JSON.stringify(payload)
  })
  .then((response) => {
    const repo = {
      name : response.name,
      fullName : response.full_name
    };
    context.repo = repo;
    Object.assign(context.bindRepo, { [context.functionName] : repo });
    chrome.storage.sync.set({ bindRepo: context.bindRepo });
    return response;
  })
  .then(getGithubRepos)
  .then(updateRepo)
  .then(updateBranch)
  .then(() => {
    showAlert(`Successfully create new repository ${repo}`);
  })
  .fail((err) => {
    showAlert("Failed to create new repository.", "error");
  });
}

function githubCreateBranch() {
  const branch = $('#new-branch-name').val();
  if (!branch || branch === "") return;
  $.getJSON(
    `${baseUrl}/repos/${context.repo.fullName}/git/refs/heads/master`,
    { access_token: accessToken }
  )
  .then((response) => {
    if (response.object) {
      return response.object.sha;
    }
    else {
      return $.getJSON(
        `${baseUrl}/repos/${context.repo.fullName}/git/refs/heads`,
        { access_token: accessToken }
      )
      .then((response) => {
        return response[0].object.sha;
      })
    }
  })
  .then((sha) => {
    const payload = {
      ref: `refs/heads/${branch}`,
      sha: sha
    };
    return $.ajax({
      url: `${baseUrl}/repos/${context.repo.fullName}/git/refs`,
      headers: {
        "Authorization": `token ${accessToken}`
      },
      method: 'POST',
      crossDomain: true,
      dataType: 'json',
      contentType: 'application/json',
      data: JSON.stringify(payload)
    });
  })
  .then((response) => {
    context.branch = branch;
    Object.assign(context.bindBranch, { [context.functionName] : branch });
    chrome.storage.sync.set({ bindBranch: context.bindBranch });
    return context.repo.name;
  })
  .then(updateBranch)
  .then(() => {
    showAlert(`Successfully create new branch: ${branch}`);
  })
  .fail((err) => {
    showAlert("Failed to create new branch.", "error");
  });
}

function showCreateRepo() {
  $('.github-repo-dropdown').hide();
  changeModelState('repo', true);
}

function showCreateBranch() {
  $('.github-branch-dropdown').hide();
  changeModelState('branch', true);
}

function initContext() {
  context = {};
  const match = window.location.href.match(/https:\/\/(.*?)\/.*functions\/(.*?)(\?|\/)((.*)\?)?/);
  if (!match) return null;
  context.endpoint = match[1];
  context.functionName = match[2];
  context.qualifier = match[5]? match[5] : "$LATEST";

  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(["csrf","token","user", "baseUrl", "bindRepo", "bindBranch"], (item) => {
      if (!item.token) {
        reject(new Error("need login"));
      }
      accessToken = item.token;
      user = item.user;
      baseUrl = item.baseUrl;
      context.bindRepo = item.bindRepo || {};
      context.bindBranch = item.bindBranch || {};
      if (item.csrf && item.csrf !== ""){
        context.csrf = item.csrf;
        resolve();
      }
      else reject(new Error("can not get csrf token"));
    });
  })
}

function initLambdaList() {
  return $.ajax({
    url: 'https://' + context.endpoint + '/lambda/services/ajax?operation=listFunctions',
    headers: {
      "X-Csrf-Token" : context.csrf
    },
    method: 'POST',
    crossDomain: true,
    dataType: 'json',
    contentType: 'application/json',
    data: JSON.stringify({operation: "listFunctions"})
  })
  .then((lambdas) => {
    context.functions = [];
    return lambdas.forEach((lambda) => {
      context.functions[lambda.name] = lambda
      if (lambda.name === context.functionName) {
        context.current = lambda;
        context.file = lambda.runtime.indexOf("nodejs") >= 0 ? "index.js" : "index.py";
      }
    })
  });
}

function getGithubRepos() {
  return $.ajax({
    url: `${baseUrl}/user/repos`,
    headers: {
      "Authorization": `token ${accessToken}`
    },
    method: 'GET',
    crossDomain: true,
    dataType: 'json',
    contentType: 'application/json'
  })
  .then((response) => {
    const repos = response.map((repo) => {
      return { name : repo.name, fullName : repo.full_name }
    });
    //if current bind still existed, use it
    const repo = context.bindRepo[context.functionName];
    if (repo && $.inArray(repo.name, repos.map(repo => repo.name)) >= 0 ) {
      context.repo = repo;
    }
    return repos;
  })
}

function initPageContent() {
  const div = $('.awsmob-button-group');
  if($('.github').length !== 0 || div.length === 0 || div.children().length <= 2) {
    throw new Error("nothing to do");
  }

  $.get(chrome.runtime.getURL('content/model.html'))
  .then((content) => {
    $('#main').siblings().last().after(content);
  });

  return $.get(chrome.runtime.getURL('content/buttons.html'))
  .then((content) => {
    return div.children().last().after(content);
  });
}

function initLoginContent() {
  const div = $('.awsmob-button-group');
  if($('.github').length !== 0 || div.length === 0 || div.children().length <= 2) {
    return;
  }
  const htmlContent = '\
    <span class="github">\
      <awsui-button>\
        <button id="github-login" class="awsui-button awsui-button-size-normal awsui-button-variant-normal awsui-hover-child-icons" type="submit">Login to Github\
        </button>\
      </awsui-button>\
    </span>';
  div.children().last().after(htmlContent);
}

function updateRepo(repos) {
  $('#github-repos').empty().append('<li><a id="github-new-repo">Create new repo</a></li>');
  repos.forEach((repo) => {
    let liContent = `<li><a class="github-repo" data=${repo.fullName}>${repo.name}</a></li>`
    $('#github-repos').append(liContent);
  });
  if (context.repo) {
    $('#github-bind-repo').text(`Repo: ${context.repo.name}`);
    return context.repo.name;
  }
  return null;
}

function updateBranch() {
  if (!context.repo) {
    return null;
  }
  return $.getJSON(
    `${baseUrl}/repos/${context.repo.fullName}/branches`,
    { access_token: accessToken }
  )
  .done((branches) => {
    $('#github-branches').empty().append('<li><a id="github-new-branch">Create new branch</a></li>');
    branches.forEach((branch) => {
      let liContent = `<li><a class="github-branch" data=${branch.name}>${branch.name}</a></li>`
      $('#github-branches').append(liContent);
    });
    let branch = context.bindBranch[context.functionName];
    if (!branch) {
      if (branches.length === 0) {
        branch = "";
        showAlert("This repository do not has any branch yet, try to create a new branch such as [master].", "warning");
      } else if ($.inArray(branch, branches.map(branch => branch.name)) < 0) {
        branch = ($.inArray("master", branches.map(branch => branch.name)) >= 0) ? "master" : branches[0].name;
      }
    }
    $('#github-bind-branch').text(`Branch: ${branch}`);
    //update context and storage
    context.branch = branch;
    Object.assign(context.bindBranch, { [context.functionName] : branch });
    chrome.storage.sync.set({ bindBranch: context.bindBranch });
    return branch;
  })
}

function changeModelState(type, toShow) {
  const index = toShow ? 0 : -1;
  const fromClass = toShow ? 'hidden' : 'fadeIn';
  const trasnferClass = toShow ? 'fadeIn' : 'fadeOut';
  const toClass = toShow ? 'showing' : 'hidden';
  $(`.github-${type}-model`).removeClass(`awsui-modal-__state-${fromClass}`).addClass(`awsui-modal-__state-${trasnferClass}`);
  setTimeout(() => {
    $(`.github-${type}-model`).removeClass(`awsui-modal-__state-${trasnferClass}`).addClass(`awsui-modal-__state-${toClass}`);
  },
  1000
  );
  $(`.github-${type}-modal-dialog`).attr('tabindex', index);
}

function changeButtonState(type, value) {
  if (!value || value === "") {
    $(`#github-create-${type}`).prop("disabled", true).addClass('awsui-button-disabled');
  } else {
    $(`#github-create-${type}`).prop("disabled", false).removeClass('awsui-button-disabled');
  }
}

//show alert using aws ui
//level: info, warning, error
function showAlert(message, level="info") {
  $.get(chrome.runtime.getURL('content/alert.html'))
  .then((content) => {
    $('.content').before(content.replace(/_INFO_/g, level).replace(/_MESSAGE_/, message));
  });
}