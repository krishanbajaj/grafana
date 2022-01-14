import React, { PureComponent } from 'react';
import { connect, ConnectedProps } from 'react-redux';
import { includes } from 'lodash';
import config from 'app/core/config';
import Page from 'app/core/components/Page/Page';
import TeamMembers from './TeamMembers';
import TeamPermissions from './TeamPermissions';
import TeamSettings from './TeamSettings';
import TeamGroupSync from './TeamGroupSync';
import { StoreState, AccessControlAction, Team } from 'app/types';
import { loadTeam, loadTeamMembers } from './state/actions';
import { getTeam, getTeamMembers, isSignedInUserTeamAdmin } from './state/selectors';
import { getTeamLoadingNav } from './state/navModel';
import { getNavModel } from 'app/core/selectors/navModel';
import { contextSrv } from 'app/core/services/context_srv';
import { NavModel } from '@grafana/data';
import { featureEnabled } from '@grafana/runtime';
import { GrafanaRouteComponentProps } from 'app/core/navigation/types';

interface TeamPageRouteParams {
  id: string;
  page: string | null;
}

export interface OwnProps extends GrafanaRouteComponentProps<TeamPageRouteParams> {}

interface State {
  isSyncEnabled: boolean;
  isLoading: boolean;
}

enum PageTypes {
  Members = 'members',
  Settings = 'settings',
  GroupSync = 'groupsync',
}

const filterPagesWithAccessControl = (team: Team | null) => {
  let res: PageTypes[] = [];
  if (team) {
    if (!contextSrv.hasPermissionInMetadata(AccessControlAction.ActionTeamsPermissionsWrite, team)) {
      res.push(PageTypes.Members);
    }
    if (
      !(
        contextSrv.hasPermissionInMetadata(AccessControlAction.ActionTeamsWrite, team) ||
        contextSrv.hasPermissionInMetadata(AccessControlAction.ActionTeamsPreferencesWrite, team)
      )
    ) {
      res.push(PageTypes.Settings);
    }
    // TODO cover with FGAC
    res.push(PageTypes.GroupSync);
  }
  return res;
};

function mapStateToProps(state: StoreState, props: OwnProps) {
  const teamId = parseInt(props.match.params.id, 10);
  const pageName = props.match.params.page ?? 'members';
  const teamLoadingNav = getTeamLoadingNav(pageName as string);
  const navModel = getNavModel(state.navIndex, `team-${pageName}-${teamId}`, teamLoadingNav);
  const team = getTeam(state.team, teamId);
  const members = getTeamMembers(state.team);

  return {
    navModel,
    teamId: teamId,
    pageName: pageName,
    team,
    members,
    editorsCanAdmin: config.editorsCanAdmin, // this makes the feature toggle mockable/controllable from tests,
    signedInUser: contextSrv.user, // this makes the feature toggle mockable/controllable from tests,
  };
}

const mapDispatchToProps = {
  loadTeam,
  loadTeamMembers,
};

const connector = connect(mapStateToProps, mapDispatchToProps);

export type Props = OwnProps & ConnectedProps<typeof connector>;

export class TeamPages extends PureComponent<Props, State> {
  constructor(props: Props) {
    super(props);

    this.state = {
      isLoading: false,
      isSyncEnabled: featureEnabled('teamsync'),
    };
  }

  async componentDidMount() {
    await this.fetchTeam();
  }

  async fetchTeam() {
    const { loadTeam, teamId } = this.props;
    this.setState({ isLoading: true });
    const team = await loadTeam(teamId);
    // TODO see if we can do something better
    if (!contextSrv.accessControlEnabled()) {
      await this.props.loadTeamMembers();
    }
    this.setState({ isLoading: false });
    return team;
  }

  getCurrentPage() {
    const pages = filterPagesWithAccessControl(this.props.team);
    const currentPage = this.props.pageName;
    return includes(pages, currentPage) ? currentPage : pages[0];
  }

  textsAreEqual = (text1: string, text2: string) => {
    if (!text1 && !text2) {
      return true;
    }

    if (!text1 || !text2) {
      return false;
    }

    return text1.toLocaleLowerCase() === text2.toLocaleLowerCase();
  };

  hideTabByType = (navModel: NavModel, pageType: string) => {
    if (navModel.main && navModel.main.children) {
      navModel.main.children
        .filter((navItem) => this.textsAreEqual(navItem.text, pageType))
        .map((navItem) => {
          navItem.hideFromTabs = true;
        });
    }
    return navModel;
  };

  hideTabsBasedOnAccessControl = (navModel: NavModel) => {
    if (this.props.team) {
      console.log(this.props);
      console.log(this.props.team);
      if (!contextSrv.hasPermissionInMetadata(AccessControlAction.ActionTeamsPermissionsWrite, this.props.team)) {
        navModel = this.hideTabByType(navModel, PageTypes.Members);
      }
      if (
        !(
          contextSrv.hasPermissionInMetadata(AccessControlAction.ActionTeamsWrite, this.props.team) ||
          contextSrv.hasPermissionInMetadata(AccessControlAction.ActionTeamsPreferencesWrite, this.props.team)
        )
      ) {
        navModel = this.hideTabByType(navModel, PageTypes.Settings);
      }
    }
    return navModel;
  };

  retrictTabs = (navModel: NavModel, isSignedInUserTeamAdmin: boolean) => {
    if (contextSrv.accessControlEnabled()) {
      return this.hideTabsBasedOnAccessControl(navModel);
    } else {
      return this.hideTabsFromNonTeamAdmin(navModel, isSignedInUserTeamAdmin);
    }
  };

  hideTabsFromNonTeamAdmin = (navModel: NavModel, isSignedInUserTeamAdmin: boolean) => {
    if (!isSignedInUserTeamAdmin && navModel.main && navModel.main.children) {
      navModel.main.children
        .filter((navItem) => !this.textsAreEqual(navItem.text, PageTypes.Members))
        .map((navItem) => {
          navItem.hideFromTabs = true;
        });
    }

    return navModel;
  };

  renderPage(isSignedInUserTeamAdmin: boolean): React.ReactNode {
    const { isSyncEnabled } = this.state;
    const { members, team } = this.props;
    const currentPage = this.getCurrentPage();

    switch (currentPage) {
      case PageTypes.Members:
        if (config.featureToggles['accesscontrol']) {
          return <TeamPermissions team={team!} />;
        } else {
          return <TeamMembers syncEnabled={isSyncEnabled} members={members} />;
        }
      case PageTypes.Settings:
        return isSignedInUserTeamAdmin && <TeamSettings team={team!} />;
      case PageTypes.GroupSync:
        return isSignedInUserTeamAdmin && isSyncEnabled && <TeamGroupSync />;
    }

    return null;
  }

  render() {
    const { team, navModel, members, editorsCanAdmin, signedInUser } = this.props;
    const isTeamAdmin = isSignedInUserTeamAdmin({ members, editorsCanAdmin, signedInUser });

    return (
      <Page navModel={this.retrictTabs(navModel, isTeamAdmin)}>
        <Page.Contents isLoading={this.state.isLoading}>
          {team && Object.keys(team).length !== 0 && this.renderPage(isTeamAdmin)}
        </Page.Contents>
      </Page>
    );
  }
}

export default connector(TeamPages);
