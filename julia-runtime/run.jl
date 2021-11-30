####
@info "COMMAND LINE ARGUMENTS"

asset_output_dir, port_str, secret, pluto_launch_params, custom_pluto_branch, custom_pluto_url, extension_port = if isempty(ARGS)
    @error "No arguments given, using development defaults!"
    mktempdir(cleanup = false), "", "4653", "asdf", "{}", "", "vscode-webview-proxy", "4654"
else
    ARGS
end
port = parse(Int, port_str)

@assert !isempty(custom_pluto_branch)


####
@info "PLUTO SETUP"
using Base64
import Pkg


pluto_spec = if isfile(joinpath(@__DIR__), "use_local_pluto.txt")
    old_load_path = deepcopy(LOAD_PATH)
    # activate global env only
    copy!(LOAD_PATH, ["@v#.#", "@stdlib"])
    @warn "Using Pluto from your global package environment!"
    import Pluto

    # revert to original load path
    copy!(LOAD_PATH, old_load_path)
else
    @info "Using Pluto from the Manifest."
end


import Pkg
env = mktempdir()
Pkg.activate(env)

pluto_spec = isempty(custom_pluto_url) ?
	Pkg.PackageSpec(
		name = "Pluto",
		rev = custom_pluto_branch
	) :
	Pkg.PackageSpec(
		url = custom_pluto_url,
		rev = custom_pluto_branch
	)


Pkg.add([
    Pkg.PackageSpec(name = "JSON", version = "0.21"),
    Pkg.PackageSpec(name = "Suppressor", version = "0.2"),
    Pkg.PackageSpec(name = "HTTP", version = "0.9.17"),
    pluto_spec
])

Pkg.instantiate()

import JSON
using Suppressor
using UUIDs

import Pluto
using HTTP

#=  These are the function which document how we communicate, through STDIN
# with the extension =#
function getNextSTDINCommand()
    new_command_str_raw = readuntil(stdin, '\0')
    new_command_str = strip(new_command_str_raw, ['\0'])
    JSON.parse(new_command_str)
end

function send(payload::String)
    HTTP.post("http://localhost:$extension_port", body=payload)
end

function sendCommand(name::String, payload::String)
    io = IOBuffer()
    io64 = Base64EncodePipe(io)
    print(io64, payload)
    close(io64)
    send("Command: [[Notebook=$(name)]] ## $(String(take!(io))) ###")
end

# This is the definition of type piracy
Base.@kwdef struct PlutoExtensionSessionData
    textRepresentations::Dict{String,String}
    notebooks::Dict{String,Pluto.Notebook}
    session::Pluto.ServerSession
    session_options::Any
    jlfilesroot::String
end

# We spin up Pluto from here.
pluto_server_options = Pluto.Configuration.from_flat_kwargs(;
    port = port,
    launch_browser = false,
    # show_file_system=false,
    dismiss_update_notification = true,
    auto_reload_from_file = true,
    (Symbol(k) => v for (k, v) in JSON.parse(pluto_launch_params))...)
pluto_server_session = Pluto.ServerSession(;
    secret = secret,
    options = pluto_server_options
)

extensionData = PlutoExtensionSessionData(
    Dict(),
    Dict(),
    pluto_server_session,
    pluto_server_options,
    joinpath(asset_output_dir, "jlfiles/")
)

function whenNotebookUpdates(jlfile, newString)
    filename = splitpath(jlfile)[end]
    sendCommand(filename, newString)
end

###
@info "OPEN NOTEBOOK"

####

function generate_output(nb::Pluto.Notebook, filename::String, vscode_proxy_root::String, frontend_params::Dict = Dict())
    @info "GENERATING HTML FOR BESPOKE EDITOR" string(nb.notebook_id)
    new_editor_contents = Pluto.generate_html(;
        pluto_cdn_root = vscode_proxy_root,
        binder_url_js = "undefined",
        notebook_id_js = repr(string(nb.notebook_id)),
        disable_ui = false,
        (Symbol(k) => v for (k, v) in frontend_params)...
    )
    write(joinpath(asset_output_dir, filename), new_editor_contents)

    @info "Bespoke editor created" filename
end


function copy_assets()
    mkpath(asset_output_dir)
    src = Pluto.project_relative_path("frontend")
    dest = asset_output_dir
    for f in readdir(src)
        cp(joinpath(src, f), joinpath(dest, f); force = true)
    end
end

copy_assets()
mkpath(extensionData.jlfilesroot)

try ## Note: This is to assist with co-developing Pluto & this Extension
    ## In a production setting it's not necessary to watch pluto folder for updates
    import BetterFileWatching
    @async try
        BetterFileWatching.watch_folder(Pluto.project_relative_path("frontend")) do event
            @info "Pluto asset changed!"
            # It's not safe to remove the folder
            # because we reuse HTML files
            copy_assets()
            mkpath(joinpath(asset_output_dir, "jlfiles/"))
        end
    catch e
        showerror(stderr, e, catch_backtrace())
    end
    @info "Watching Pluto folder for changes!"
catch
end

function registerOnFileSaveListener(notebook::Pluto.notebook)
    function onfilechange(pe::Pluto.PlutoEvent)
        if pe isa Pluto.FileSaveEvent
            whenNotebookUpdates(pe.path, pe.fileContent)
        end
    end
    notebook.write_out_fs = false
    notebook.listeners = [onfilechange, notebook.listeners...]
end

command_task = Pluto.@asynclog while true
    filenbmap = extensionData.notebooks
    new_command = getNextSTDINCommand()

    @info "New command received!" new_command

    type = get(new_command, "type", "")
    detail = get(new_command, "detail", Dict())


    if type == "open"
        editor_html_filename = detail["editor_html_filename"]
        vscode_proxy_root = let
            s = get(detail, "vscode_proxy_root", "not given")
            if isempty(s) || endswith(s, "/")
                s
            else
                s * "/"
            end
        end
        frontend_params = get(detail, "frontend_params", Dict())


        jlpath = joinpath(extensionData.jlfilesroot, detail["jlfile"])
        extensionData.textRepresentations[detail["jlfile"]] = detail["text"]
        open(jlpath, "w") do f
            write(f, detail["text"])
        end
        nb = Pluto.SessionActions.open(pluto_server_session, jlpath; notebook_id = UUID(detail["notebook_id"]))

        registerOnFileSaveListener(nb)

        filenbmap[detail["jlfile"]] = nb
        generate_output(nb, editor_html_filename, vscode_proxy_root, frontend_params)

    elseif type == "update"
        nb = filenbmap[detail["jlfile"]]
        jlpath = joinpath(extensionData.jlfilesroot, detail["jlfile"])
        open(jlpath, "w") do f
            write(f, detail["text"])
        end
        Pluto.update_from_file(pluto_server_session, nb)
        extensionData.textRepresentations[detail["jlfile"]] = detail["text"]

    elseif type == "shutdown"
        nb = get(filenbmap, detail["jlfile"], nothing)
        !isnothing(nb) && Pluto.SessionActions.shutdown(
            pluto_server_session,
            nb,
            keep_in_session = false
        )

    else
        @error "Message of this type not recognised. " type
    end

end

####
@info "RUNNING PLUTO SERVER..."
@info "MESSAGE TO EXTENSION: READY FOR COMMANDS"

@suppress_out Pluto.run(pluto_server_session)

Base.throwto(command_task, InterruptException())